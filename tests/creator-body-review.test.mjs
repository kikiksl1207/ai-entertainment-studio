import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-review.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const fields = ['styleReviewed', 'charactersReviewed', 'timelineReviewed'];
const flags = ['generationStarted', 'imageGenerationStarted', 'publicationStarted', 'sharedReuseAuthorized'];
const binding = 'ab'.repeat(32), checksum = 'cd'.repeat(32);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const row = (extra = {}) => ({ id: id(7), locale: 'ko', version: 1, decision: 'approve',
  styleReviewed: true, charactersReviewed: true, timelineReviewed: true,
  createdAt: '2026-10-03T01:00:00.000Z', withdrawnAt: null, applicability: 'current', ...extra });
const review = (workId = id(1), locale = 'ko', extra = {}) => ({
  contract: 'story-author-body-review-v1', workId, locale, readOnly: true,
  generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false,
  state: 'reviewable', target: { progressId: id(2), progressRevision: 2, sceneId: id(3),
    sourceBindingHash: binding, bodyChecksum: checksum, ending: false }, latestReview: null, ...extra
});
const preview = (workId = id(1), locale = 'ko') => ({
  contract: 'story-author-body-preview-v1', workId, locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 2, storyVersion: 1, status: 'active',
    scene: { id: id(3), isGenerated: true, title: 'Private generated scene', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'Private generated body.\r\n  Exact spacing. \uD55C\uAE00' }] }, choices: [] }
});
const receipt = (workId = id(1), locale = 'ko', extra = {}) => ({
  contract: 'story-author-body-review-v1', workId, locale,
  generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false,
  idempotentReplay: false, review: row({ locale }), ...extra
});
const response = (data, status = 200, extra = {}) => ({ status, headers: { get: () => null },
  text: async () => JSON.stringify(data), ...extra });
const rejectionCode = name => `STORY_AUTHOR_BODY_REVIEW_${name}`;
// The shared transport returns the HttpExceptionFilter wire envelope unchanged.
const rejectionBody = (code, path, status = 409) => ({ success: false, error: { code, statusCode: status, path,
  message: 'PRIVATE_DIAGNOSTIC_DO_NOT_DISPLAY', requestId: 'private-request-id', timestamp: '2026-10-04T01:00:00.000Z' } });
const rejection = (code, path, status = 409) => response(rejectionBody(code, path, status), status);
const expectedBody = { locale: 'ko', sourceBindingHash: binding, expectedProgressRevision: 2,
  expectedReviewId: null, decision: 'approve', styleReviewed: true, charactersReviewed: true, timelineReviewed: true };

function library(extra = {}) {
  const forbidden = () => { throw new Error('Storage, timers and global network are forbidden'); };
  const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden };
  const window = { crypto: { randomUUID: () => id(90) }, fetch: forbidden,
    localStorage: storage, sessionStorage: storage, indexedDB: { open: forbidden }, setTimeout: forbidden, setInterval: forbidden };
  const vm = createContext({ window, TextEncoder, TextDecoder, AbortController, fetch: forbidden,
    setTimeout: forbidden, setInterval: forbidden, ...extra });
  runInContext(previewSource, vm); runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyReview, vm };
}
function screen(handler = ({ reply }) => reply(), settings = {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko';
  let shown = true, authorized = true, brokenIdentity = false, keyCount = 0;
  const { api, vm } = library(), calls = [], states = [], dispatches = [];
  const options = {
    fetch: async (url, options) => {
      const kind = options.method === 'POST' ? url.endsWith('/withdraw') ? 'withdraw' : 'decision' : url.includes('/body-review') ? 'review' : 'preview';
      const target = { workId, locale: sourceLocale }, call = { url, options, kind }; calls.push(call);
      const reply = () => {
        if (kind === 'review') return response(review(workId, sourceLocale));
        if (kind === 'preview') return response(preview(workId, sourceLocale));
        if (kind === 'withdraw') return response(receipt(workId, sourceLocale, {
          review: row({ locale: sourceLocale, withdrawnAt: '2026-10-03T02:00:00Z', applicability: 'withdrawn' }) }));
        const body = JSON.parse(options.body);
        return response(receipt(workId, sourceLocale, { review: row({ locale: sourceLocale,
          ...Object.fromEntries(['decision', ...fields].map(key => [key, body[key]])) }) }), 201);
      };
      return handler({ ...call, target, calls, reply });
    },
    identity: () => { if (brokenIdentity) throw new Error('Private identity failure'); return owner; },
    isCurrent: value => authorized && owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => states.push(clone(state)), onDispatch: () => { dispatches.push(true); settings.onDispatch?.(); },
    makeIdempotencyKey: () => { keyCount++; return `review-test-${String(keyCount).padStart(4, '0')}`; }
  };
  if (Object.hasOwn(settings, 'makeIdempotencyKey')) options.makeIdempotencyKey = settings.makeIdempotencyKey;
  if (settings.defaultKey) delete options.makeIdempotencyKey;
  if (settings.parsePreview) options.parsePreview = settings.parsePreview;
  const controller = api.createController(options);
  return { ...controller, controller, options, api, vm, calls, states, dispatches, keys: () => keyCount, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; },
    brokenIdentity: value => { brokenIdentity = value; }
  } };
}
const posts = view => view.calls.filter(call => call.options.method === 'POST');
function checkAll(view) { for (const field of fields) assert.equal(view.setReviewed(field, true), true); }
function assertCleared(view) {
  const value = view.snapshot(); assert.equal(value.data, null); assert.equal(value.receipt, null);
  assert.doesNotMatch(JSON.stringify(value), /Private generated|Exact spacing/);
  assert.ok(fields.every(key => value.reviewed[key] === false));
}
function assertUncertain(view) {
  assert.equal(view.snapshot().unresolved, true); assert.equal(view.snapshot().receipt, null);
  assert.equal(view.snapshot().canReview, false); assert.equal(view.snapshot().canWithdraw, false); assert.equal(view.snapshot().busy, false);
}
function assertReplay(first, next, epoch = 1) {
  assert.equal(next.url, first.url); assert.equal(next.options.body, first.options.body);
  assert.equal(next.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']);
  assert.deepEqual(clone(next.options.identity), { ownerId: id(8), epoch });
  assert.equal(next.options._retried, true); assert.equal(next.options.cache, 'no-store');
}

test('bounded API starts idle without storage, polling, global networking or mutations', async () => {
  const view = screen();
  for (const name of ['parseReview', 'parseReceipt', 'createController', 'mount']) assert.equal(typeof view.api[name], 'function');
  for (const name of ['invalidate', 'load', 'syncContext', 'snapshot', 'destroy', 'setReviewed', 'decide', 'withdraw', 'retry']) assert.equal(typeof view[name], 'function');
  assert.equal(await view.decide('approve'), false); assert.equal(await view.decide('reject'), false);
  assert.equal(await view.withdraw(), false); assert.equal(await view.retry(), false);
  view.invalidate(); view.syncContext(); view.snapshot();
  assert.equal(view.calls.length, 0); assert.equal(view.keys(), 0);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setInterval|setTimeout|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /\/generate|\/images|\/publish|\/payments/);
});

test('explicit load validates review GET before same-locale preview, without deciding', async () => {
  const pending = deferred(), view = screen(({ kind, reply }) => kind === 'review' ? pending.promise : reply());
  const task = view.load(); assert.equal(view.calls.length, 1); assert.equal(view.snapshot().canReview, false);
  pending.resolve(response(review())); assert.equal(await task, true);
  assert.deepEqual(view.calls.map(call => call.url), [
    `/api/v1/me/creator-studio/stories/${id(1)}/body-review?locale=ko`,
    `/api/v1/me/creator-studio/stories/${id(1)}/body-preview?locale=ko`
  ]);
  for (const { options } of view.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options._retried, true); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-store'); assert.equal(options.body, undefined); assert.ok(options.signal);
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  }
  assert.deepEqual(clone(view.snapshot().data), { review: review(), preview: preview() });
  assert.equal(view.snapshot().canReview, true); assert.equal(view.snapshot().canApprove, false); assert.equal(view.snapshot().canReject, false);
  assert.equal(posts(view).length, 0); assert.equal(view.dispatches.length, 0);
});

test('projections normalize UUIDs, preserve row locale and drop uncontracted private fields', () => {
  const { api } = library(), workId = 'A0000001-ABCD-4ABC-8ABC-ABCDEF000001';
  const value = review(workId, 'en', { latestReview: row({ locale: 'en' }), secret: 'discard' });
  value.target.sceneId = 'A0000003-ABCD-4ABC-8ABC-ABCDEF000003'; value.target.prompt = 'discard'; value.latestReview.owner = 'discard';
  const result = clone(api.parseReview(value, { workId: workId.toLowerCase(), locale: 'en' }));
  assert.equal(result.workId, workId.toLowerCase()); assert.equal(result.target.sceneId, value.target.sceneId.toLowerCase());
  assert.equal(result.latestReview.locale, 'en'); assert.doesNotMatch(JSON.stringify(result), /discard|prompt|secret|owner/);
  assert.deepEqual(clone(api.parseReceipt({ ...receipt(), secret: 'discard' }, { workId: id(1), body: expectedBody })), receipt());
  assert.throws(() => api.parseReceipt(receipt(), { workId: id(99), body: expectedBody }));
  assert.throws(() => api.parseReview(value, { workId, locale: 'ja' }));
});

const invalidReviews = {
  contract: value => { value.contract = 'other'; }, work: value => { value.workId = id(99); }, locale: value => { value.locale = 'en'; },
  readOnly: value => { value.readOnly = false; }, state: value => { value.state = 'authorized'; }, target: value => { value.target = null; },
  progress: value => { value.target.progressId = 'bad'; }, revision: value => { value.target.progressRevision = '2'; },
  scene: value => { value.target.sceneId = '../bad'; }, binding: value => { value.target.sourceBindingHash = 'a'.repeat(63); },
  checksum: value => { value.target.bodyChecksum = 'g'.repeat(64); }, ending: value => { value.target.ending = 'false'; },
  latest: value => { value.latestReview = []; }, currentLocale: value => { value.latestReview = row({ locale: 'en' }); },
  sourceTarget: value => { value.state = 'source_changed'; }, sourceCurrent: value => { value.state = 'source_changed'; value.target = null; value.latestReview = row(); },
  sourceSuperseded: value => { value.state = 'source_changed'; value.target = null; value.latestReview = row({ applicability: 'superseded' }); }
};
for (const key of ['readOnly', 'state', 'target', 'latestReview', ...flags]) invalidReviews[`missing-${key}`] = value => { delete value[key]; };
for (const key of flags) invalidReviews[key] = value => { value[key] = true; };
for (const key of ['progressRevision']) for (const [label, number] of [['zero', 0], ['negative', -1], ['fraction', 0.5], ['unsafe', Number.MAX_SAFE_INTEGER + 1]]) {
  invalidReviews[`${key}-${label}`] = value => { value.target[key] = number; };
}
const invalidRows = {
  id: value => { value.id = 'bad'; }, locale: value => { value.locale = 'fr'; }, 'missing-locale': value => { delete value.locale; },
  version: value => { value.version = 0; }, decision: value => { value.decision = 'publish'; }, createdAt: value => { value.createdAt = '2026-02-30T01:00:00Z'; },
  'non-iso': value => { value.createdAt = 'October 3 2026'; }, withdrawnAt: value => { value.withdrawnAt = 'bad'; },
  'withdrawn-missing-time': value => { value.applicability = 'withdrawn'; }, 'time-with-current': value => { value.withdrawnAt = '2026-10-03T02:00:00Z'; },
  'withdraw-before-created': value => { value.applicability = 'withdrawn'; value.withdrawnAt = '2000-01-01T00:00:00Z'; },
  applicability: value => { value.applicability = 'unknown'; }, 'approve-incomplete': value => { value.styleReviewed = false; },
  'reject-unreviewed': value => { value.decision = 'reject'; for (const key of fields) value[key] = false; }
};
for (const key of fields) invalidRows[key] = value => { value[key] = 'true'; };
for (const [name, corrupt] of Object.entries(invalidRows)) invalidReviews[`row-${name}`] = value => { value.latestReview = row(); corrupt(value.latestReview); };
for (const [name, corrupt] of Object.entries(invalidReviews)) test(`malformed GET fails closed before preview: ${name}`, async () => {
  const view = screen(({ kind, reply }) => { if (kind !== 'review') return reply(); const value = review(); corrupt(value); return response(value); });
  assert.equal(await view.load(), false); assertCleared(view); assert.equal(view.snapshot().canReview, false);
  assert.equal(view.calls.length, 1); assert.equal(posts(view).length, 0);
});

for (const [name, corrupt] of Object.entries({
  progress: value => { value.progress.progressId = id(99); }, revision: value => { value.progress.revision++; },
  scene: value => { value.progress.scene.id = id(99); }, original: value => { value.progress.scene.isGenerated = false; },
  ending: value => { value.progress.scene.endingType = 'ai_generated'; }, pending: value => { value.progress.status = 'ai_pending'; },
  unknown: value => { value.progress.status = 'unknown'; }, missing: value => { value.progress = null; },
  malformed: value => { value.progress.scene.beats = []; }, locale: value => { value.locale = 'en'; }
})) test(`preview must match target before exposing decision or body: ${name}`, async () => {
  const view = screen(({ kind, reply }) => { if (kind !== 'preview') return reply(); const value = preview(); corrupt(value); return response(value); });
  assert.equal(await view.load(), false); assertCleared(view); assert.equal(view.snapshot().canApprove, false);
  assert.equal(await view.decide('reject'), false); assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0);
});

test('generated ending remains explicitly reviewable', async () => {
  const view = screen(({ kind, reply }) => {
    if (kind === 'review') { const value = review(); value.target.ending = true; return response(value); }
    if (kind === 'preview') { const value = preview(); value.progress.status = 'completed'; value.progress.scene.endingType = 'ai_generated'; return response(value); }
    return reply();
  });
  await view.load(); checkAll(view); assert.equal(view.snapshot().canApprove, true); assert.equal(await view.decide('approve'), true);
});

test('reviewed checkboxes enforce approve all three, reject at least one, without automatic POST', async () => {
  const view = screen(); await view.load();
  assert.equal(await view.decide('approve'), false); assert.equal(await view.decide('reject'), false);
  assert.equal(view.setReviewed('qualityGuaranteed', true), false); assert.equal(view.setReviewed('styleReviewed', 1), false);
  view.setReviewed('styleReviewed', true); assert.equal(view.snapshot().canApprove, false); assert.equal(view.snapshot().canReject, true);
  assert.equal(posts(view).length, 0); assert.equal(await view.decide('approve'), false);
  assert.equal(await view.decide('reject'), true);
  assert.deepEqual(JSON.parse(posts(view)[0].options.body), { ...expectedBody, decision: 'reject', charactersReviewed: false, timelineReviewed: false });
  assert.equal(view.calls.length, 5); assert.equal(view.snapshot().unresolved, false);
  assert.ok(fields.every(key => view.snapshot().reviewed[key] === false));
});

test('approve sends exact guards and refreshes applicability only after a verified receipt', async () => {
  let accepted = false;
  const view = screen(({ kind, reply }) => {
    if (kind === 'decision') { accepted = true; return reply(); }
    if (kind === 'review' && accepted) return response(review(id(1), 'ko', { latestReview: row({ applicability: 'stale' }) }));
    return reply();
  });
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), true);
  assert.deepEqual(JSON.parse(posts(view)[0].options.body), expectedBody);
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], 'review-test-0001');
  assert.equal(view.snapshot().receipt.review.applicability, 'current'); assert.equal(view.snapshot().data.review.latestReview.applicability, 'stale');
  assert.deepEqual(view.calls.map(call => call.kind), ['review', 'preview', 'decision', 'review', 'preview']);
  assert.equal(view.dispatches.length, 1);
});

test('latest record is included as expectedReviewId, without prechecking its previous decision', async () => {
  const value = review(id(1), 'ko', { latestReview: row() });
  const view = screen(({ kind, reply }) => kind === 'review' ? response(value) : reply());
  await view.load(); assert.ok(fields.every(key => !view.snapshot().reviewed[key])); checkAll(view); await view.decide('approve');
  assert.equal(JSON.parse(posts(view)[0].options.body).expectedReviewId, id(7));
});

for (const state of ['not_generated', 'generation_pending', 'source_changed']) test(`${state} has no decision target, preserves stale withdrawal`, async () => {
  const value = review(id(1), 'ko', { state, target: null, latestReview: row({ applicability: 'stale' }) });
  const view = screen(({ kind, reply }) => kind === 'review' ? response(value) : reply());
  assert.equal(await view.load(), true); assert.equal(view.snapshot().messageKey, state);
  assert.equal(view.snapshot().canReview, false); assert.equal(view.setReviewed('styleReviewed', true), false);
  assert.equal(await view.decide('approve'), false); assert.equal(await view.decide('reject'), false);
  assert.equal(view.snapshot().canWithdraw, true); assert.equal(await view.withdraw(), true);
  assert.equal(posts(view)[0].url, `/api/v1/me/creator-studio/stories/${id(1)}/body-review/${id(7)}/withdraw`);
  assert.equal(posts(view)[0].options.body, '{}'); assert.equal(view.keys(), 1);
});

test('source_changed may preserve an old-language row; withdrawal receipt binds to row locale, not selected locale', async () => {
  let withdrawn = false;
  const view = screen(({ kind, reply }) => {
    const latest = row({ locale: 'ja', applicability: withdrawn ? 'withdrawn' : 'stale', withdrawnAt: withdrawn ? '2026-10-03T02:00:00Z' : null });
    if (kind === 'review') return response(review(id(1), 'ko', { state: 'source_changed', target: null, latestReview: latest }));
    if (kind === 'withdraw') { withdrawn = true; return response(receipt(id(1), 'ja', { review: { ...latest, withdrawnAt: '2026-10-03T02:00:00Z', applicability: 'withdrawn' } })); }
    return reply();
  });
  await view.load(); assert.equal(view.snapshot().data.review.latestReview.locale, 'ja');
  assert.equal(await view.withdraw(), true); assert.equal(view.snapshot().receipt.locale, 'ja');
  assert.equal(view.snapshot().data.review.latestReview.applicability, 'withdrawn'); assert.equal(view.snapshot().canWithdraw, false);
  assert.equal(await view.withdraw(), false); assert.equal(posts(view).length, 1);
});

test('lost withdrawal including a later 409 retains exact key until manual same-key replay', async () => {
  let attempts = 0;
  const value = review(id(1), 'en', { state: 'source_changed', target: null, latestReview: row({ locale: 'ja', applicability: 'stale' }) });
  const view = screen(({ kind, reply }) => {
    if (kind === 'review') return response(value);
    if (kind !== 'withdraw') return reply();
    if (++attempts === 1) throw new TypeError('Lost receipt');
    if (attempts === 2) return response({}, 409);
    return response(receipt(id(1), 'ja', { idempotentReplay: true,
      review: row({ locale: 'ja', applicability: 'withdrawn', withdrawnAt: '2026-10-03T02:00:00Z' }) }));
  });
  view.set.source('en'); await view.load(); await view.withdraw(); assertUncertain(view);
  await view.retry(); assertUncertain(view); assert.equal(view.keys(), 1);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assertReplay(posts(view)[0], posts(view)[2]);
  assert.equal(view.snapshot().unresolved, false); assert.equal(view.snapshot().receipt.locale, 'ja');
});

for (const status of [404, 409]) test(`verified source_changed head remains withdrawable when published preview returns ${status}`, async () => {
  let withdrawn = false;
  const view = screen(({ kind, reply }) => {
    if (kind === 'review') return response(review(id(1), 'ko', { state: 'source_changed', target: null,
      latestReview: row({ locale: 'ja', applicability: withdrawn ? 'withdrawn' : 'stale', withdrawnAt: withdrawn ? '2026-10-03T02:00:00Z' : null }) }));
    if (kind === 'preview') return response({ secret: 'Unavailable unpublished prose' }, status);
    if (kind === 'withdraw') { withdrawn = true; return response(receipt(id(1), 'ja', {
      review: row({ locale: 'ja', applicability: 'withdrawn', withdrawnAt: '2026-10-03T02:00:00Z' }) })); }
    return reply();
  });
  assert.equal(await view.load(), true); assert.equal(view.snapshot().data.preview, null); assert.equal(view.snapshot().canWithdraw, true);
  assert.equal(view.snapshot().canReview, false); assert.equal(await view.decide('approve'), false);
  assert.equal(await view.withdraw(), true); assert.equal(view.snapshot().canWithdraw, false);
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /Unavailable unpublished prose|Private generated/);
});

test('source_changed never bypasses initial ownership 404 or authentication failure on preview', async () => {
  const unauthorized = screen(() => response({}, 404)); assert.equal(await unauthorized.load(), false);
  assert.equal(unauthorized.calls.length, 1); assert.equal(unauthorized.snapshot().canWithdraw, false);
  const expired = screen(({ kind, reply }) => kind === 'review' ? response(review(id(1), 'ko', {
    state: 'source_changed', target: null, latestReview: row({ applicability: 'stale' }) })) : kind === 'preview' ? response({}, 401) : reply());
  assert.equal(await expired.load(), false); assertCleared(expired); assert.equal(expired.snapshot().canWithdraw, false);
});

const invalidReceipts = {
  contract: value => { value.contract = 'other'; }, locale: value => { value.locale = 'ja'; }, work: value => { value.workId = id(99); },
  replay: value => { value.idempotentReplay = 'true'; }, row: value => { value.review = null; },
  'wrong-decision': value => { value.review.decision = 'reject'; }, 'wrong-row-locale': value => { value.review.locale = 'ja'; }
};
for (const key of flags) {
  invalidReceipts[key] = value => { value[key] = true; };
  invalidReceipts[`missing-${key}`] = value => { delete value[key]; };
}
for (const [name, corrupt] of Object.entries(invalidRows)) invalidReceipts[`row-${name}`] = value => corrupt(value.review);
for (const [name, corrupt] of Object.entries(invalidReceipts)) test(`malformed receipt retains unresolved command without automatic retry: ${name}`, async () => {
  const view = screen(({ kind, reply }) => { if (kind !== 'decision') return reply(); const value = receipt(); corrupt(value); return response(value); });
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), false); assertUncertain(view); assertCleared(view);
  assert.equal(view.snapshot().canRetry, true); assert.equal(posts(view).length, 1); assert.equal(view.calls.length, 3);
  view.snapshot(); view.syncContext(); assert.equal(posts(view).length, 1);
});

test('withdrawal requires matching review ID and a withdrawn row, including historic replay', async () => {
  const { api } = library(), command = { kind: 'withdraw', workId: id(1), locale: 'ko', receiptLocale: 'ja', reviewId: id(7), body: {} };
  const value = receipt(id(1), 'ja', { idempotentReplay: true, review: row({ locale: 'ja', withdrawnAt: '2026-10-03T02:00:00Z', applicability: 'withdrawn' }) });
  assert.equal(api.parseReceipt(value, command).review.locale, 'ja');
  assert.throws(() => api.parseReceipt({ ...value, review: row({ ...value.review, id: id(99) }) }, command));
  assert.throws(() => api.parseReceipt(receipt(id(1), 'ja'), command));
});

for (const status of [202, 204, 299, 302, 400, 401, 403, 404, 409, 422, 429, 500, 503]) test(`unknown or failed POST ${status} never proves receipt or discards command`, async () => {
  const view = screen(({ kind, reply }) => kind === 'decision' ? response(receipt(), status) : reply());
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), false); assertUncertain(view);
  assert.equal(view.calls.length, 3); assert.equal(view.keys(), 1); assert.equal(view.snapshot().canRetry, true);
});

for (const name of ['SOURCE_CHANGED', 'HEAD_CHANGED']) test(`verified ${name} retires only the rejected command; manual refresh permits a new guarded review`, async () => {
  let rejected = false, attempts = 0;
  const changedBinding = 'ef'.repeat(32), latest = row({ id: id(17) });
  const view = screen(({ kind, url, reply }) => {
    if (kind === 'decision' && ++attempts === 1) { rejected = true; return rejection(rejectionCode(name), url); }
    if (kind === 'review' && rejected) {
      const value = review(id(1), 'ko', { latestReview: latest }); value.target.progressRevision = 3; value.target.sourceBindingHash = changedBinding;
      return response(value);
    }
    if (kind === 'preview' && rejected) { const value = preview(); value.progress.revision = 3; return response(value); }
    return reply();
  });
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), false);
  assertCleared(view); assert.equal(view.snapshot().unresolved, false); assert.equal(view.snapshot().canRetry, false);
  assert.equal(view.snapshot().messageKey, 'conflict'); assert.equal(view.snapshot().canLoad, true);
  assert.equal(view.calls.length, 3); assert.equal(await view.decide('approve'), false);
  assert.equal(await view.retry(), false); assert.equal(posts(view).length, 1);
  await view.load(); assert.equal(view.snapshot().canReview, true); assert.equal(view.snapshot().canApprove, false);
  assert.equal(posts(view).length, 1); checkAll(view); assert.equal(await view.decide('approve'), true);
  assert.equal(posts(view).length, 2); assert.equal(view.keys(), 2);
  assert.notEqual(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(posts(view)[1].options.body), { ...expectedBody, sourceBindingHash: changedBinding,
    expectedProgressRevision: 3, expectedReviewId: latest.id });
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /PRIVATE_DIAGNOSTIC|private-request-id/);
});

test('source rejection can refresh to a stale head and then withdraw with a new explicit action', async () => {
  let changed = false;
  const view = screen(({ kind, url, reply }) => {
    if (kind === 'decision') { changed = true; return rejection(rejectionCode('SOURCE_CHANGED'), url); }
    if (kind === 'review' && changed) return response(review(id(1), 'ko', {
      state: 'source_changed', target: null, latestReview: row({ locale: 'ja', applicability: 'stale' }) }));
    if (kind === 'preview' && changed) return response({}, 404);
    if (kind === 'withdraw') return response(receipt(id(1), 'ja', {
      review: row({ locale: 'ja', withdrawnAt: '2026-10-04T02:00:00Z', applicability: 'withdrawn' }) }));
    return reply();
  });
  await view.load(); checkAll(view); await view.decide('approve'); assert.equal(view.snapshot().unresolved, false);
  await view.load(); assert.equal(view.snapshot().canWithdraw, true); assert.equal(view.snapshot().canReview, false);
  assert.equal(posts(view).length, 1); assert.equal(await view.withdraw(), true);
  assert.equal(posts(view).length, 2); assert.equal(posts(view)[1].options.body, '{}'); assert.equal(view.keys(), 2);
});

test('other-tab withdrawal is a definitive rejection, not an uncertain receipt; manual refresh resumes review', async () => {
  let withdrawnElsewhere = false;
  const latest = () => row({ applicability: withdrawnElsewhere ? 'withdrawn' : 'current',
    withdrawnAt: withdrawnElsewhere ? '2026-10-04T02:00:00Z' : null });
  const view = screen(({ kind, url, reply }) => {
    if (kind === 'review') return response(review(id(1), 'ko', { latestReview: latest() }));
    if (kind === 'withdraw') { withdrawnElsewhere = true; return rejection(rejectionCode('ALREADY_WITHDRAWN'), url); }
    return reply();
  });
  await view.load(); assert.equal(await view.withdraw(), false); assertCleared(view);
  assert.equal(view.snapshot().unresolved, false); assert.equal(view.snapshot().receipt, null); assert.equal(view.calls.length, 3);
  await view.load(); assert.equal(view.snapshot().data.review.latestReview.applicability, 'withdrawn');
  assert.equal(view.snapshot().canWithdraw, false); assert.equal(await view.withdraw(), false); assert.equal(view.snapshot().canReview, true);
  assert.equal(posts(view).length, 1); checkAll(view); assert.equal(await view.decide('approve'), true);
  assert.equal(JSON.parse(posts(view)[1].options.body).expectedReviewId, id(7)); assert.equal(view.keys(), 2);
});

test('manual same-key retry may prove a pre-commit rejection after a lost initial response', async () => {
  let attempts = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind !== 'decision') return reply();
    if (++attempts === 1) throw new TypeError('Lost response');
    if (attempts === 2) return rejection(rejectionCode('HEAD_CHANGED'), url);
    return reply();
  });
  await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view);
  await view.retry(); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
  assert.equal(view.snapshot().unresolved, false); assert.equal(view.calls.length, 4);
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), true); assert.equal(view.keys(), 2);
});

for (const status of [200, 201, 400, 401, 403, 404, 408, 422, 429, 500, 503]) {
  test(`allowlisted code at wrong HTTP status ${status} stays uncertain and retries only with the same key`, async () => {
    let attempts = 0;
    const view = screen(({ kind, url, reply }) => {
      if (kind !== 'decision') return reply();
      return ++attempts === 1 ? rejection(rejectionCode('SOURCE_CHANGED'), url, status) : response(receipt(id(1), 'ko', { idempotentReplay: true }));
    });
    await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view);
    assert.equal(view.calls.length, 3); assert.equal(view.keys(), 1);
    assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
  });
}

const invalidRejections = {
  'bare-service-code': value => ({ code: value.error.code }),
  'missing-success': value => { delete value.success; return value; },
  'success-true': value => { value.success = true; return value; },
  'success-string': value => { value.success = 'false'; return value; },
  'error-array': value => { value.error = [value.error]; return value; },
  'status-missing': value => { delete value.error.statusCode; return value; },
  'status-string': value => { value.error.statusCode = '409'; return value; },
  'status-mismatch': value => { value.error.statusCode = 503; return value; },
  'path-missing': value => { delete value.error.path; return value; },
  'path-wrong-work': value => { value.error.path = value.error.path.replace(id(1), id(99)); return value; },
  'path-wrong-endpoint': value => { value.error.path += '/unrelated'; return value; },
  'code-missing': value => { delete value.error.code; return value; },
  'code-case': value => { value.error.code = value.error.code.toLowerCase(); return value; },
  'code-array': value => { value.error.code = [value.error.code]; return value; },
  'code-unconfirmed': value => { value.error.code = rejectionCode('OUTCOME_UNCONFIRMED'); return value; },
  'code-idempotency-conflict': value => { value.error.code = rejectionCode('IDEMPOTENCY_CONFLICT'); return value; },
  'code-input-invalid': value => { value.error.code = rejectionCode('INPUT_INVALID'); return value; },
  'message-malformed': value => { value.error.message = {}; return value; },
  'timestamp-malformed': value => { value.error.timestamp = 'not-a-date'; return value; }
};
for (const [name, corrupt] of Object.entries(invalidRejections)) test(`unverified rejection ${name} never retires the command`, async () => {
  let attempts = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind !== 'decision') return reply();
    return ++attempts === 1 ? response(corrupt(rejectionBody(rejectionCode('HEAD_CHANGED'), url)), 409) : response(receipt(id(1), 'ko', { idempotentReplay: true }));
  });
  await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view);
  assert.equal(view.calls.length, 3); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

for (const [kind, name] of [['review', 'ALREADY_WITHDRAWN'], ['withdraw', 'SOURCE_CHANGED'], ['withdraw', 'HEAD_CHANGED']]) {
  test(`${name} is definitive only for its own command type, not ${kind}`, async () => {
    const view = screen(({ kind: callKind, url, reply }) => {
      if (callKind === 'review') return response(review(id(1), 'ko', { latestReview: row() }));
      return ['decision', 'withdraw'].includes(callKind) ? rejection(rejectionCode(name), url) : reply();
    });
    await view.load(); if (kind === 'review') { checkAll(view); await view.decide('approve'); } else await view.withdraw();
    assertUncertain(view); assert.equal(view.snapshot().canRetry, true); assert.equal(posts(view).length, 1);
  });
}

for (const name of ['invalid-json', 'oversized-length', 'oversized-body', 'broken-reader', 'network', 'timeout', 'forged-error']) {
  test(`unreadable or transport rejection ${name} keeps the exact pending command`, async () => {
    let attempts = 0;
    const view = screen(({ kind, url, reply }) => {
      if (kind !== 'decision') return reply();
      if (++attempts > 1) return response(receipt(id(1), 'ko', { idempotentReplay: true }));
      if (name === 'network') throw new TypeError('Connection lost');
      if (name === 'timeout') throw Object.assign(new Error('Timed out'), { name: 'TimeoutError' });
      if (name === 'forged-error') throw Object.assign(new Error('Not a verified response'), {
        status: 409, code: rejectionCode('SOURCE_CHANGED'), definitive: true });
      const value = rejectionBody(rejectionCode('HEAD_CHANGED'), url);
      const extra = name === 'invalid-json' ? { text: async () => '{broken' } : name === 'oversized-length' ? { headers: { get: () => '99999' } }
        : name === 'oversized-body' ? { text: async () => JSON.stringify({ ...value, diagnostics: 'x'.repeat(5000) }) }
          : { text: async () => { throw new Error('Receipt stream interrupted'); } };
      return response(value, 409, extra);
    });
    await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view);
    assert.equal(view.calls.length, 3); assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
  });
}

test('OUTCOME_UNCONFIRMED never retires a possibly committed withdrawal; manual replay is exact', async () => {
  let attempts = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind === 'review') return response(review(id(1), 'ko', { latestReview: row() }));
    if (kind === 'withdraw' && ++attempts === 1) return rejection(rejectionCode('OUTCOME_UNCONFIRMED'), url, 503);
    return kind === 'withdraw' ? response(receipt(id(1), 'ko', { idempotentReplay: true,
      review: row({ withdrawnAt: '2026-10-04T02:00:00Z', applicability: 'withdrawn' }) })) : reply();
  });
  await view.load(); await view.withdraw(); assertUncertain(view); assert.equal(posts(view).length, 1);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

test('lost decision receipt stays exact through GET, invalidate and same-owner renewed auth epoch', async () => {
  let attempts = 0;
  const view = screen(({ kind, reply }) => {
    if (kind === 'decision' && ++attempts === 1) throw new TypeError('Committed but receipt lost');
    return kind === 'decision' ? response(receipt(id(1), 'ko', { idempotentReplay: true })) : reply();
  });
  await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view);
  await view.load(); assertUncertain(view); assert.equal(view.snapshot().canReview, false); assert.equal(posts(view).length, 1);
  view.set.owner({ ownerId: id(8), epoch: 2 }); view.invalidate(); assertCleared(view); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1], 2); assert.equal(view.keys(), 1);
  assert.equal(view.snapshot().unresolved, false);
});

for (const [name, change] of [
  ['work', view => view.set.work(id(9))], ['source', view => view.set.source('en')],
  ['owner', view => view.set.owner({ ownerId: id(9), epoch: 2 })], ['epoch', view => view.set.owner({ ownerId: id(8), epoch: 2 })],
  ['ui-locale', view => view.set.language('ja')], ['hidden', view => view.set.shown(false)],
  ['signed-out', view => view.set.owner(null)], ['invalid-current', view => view.set.authorized(false)],
  ['identity-failure', view => view.set.brokenIdentity(true)], ['invalidate', view => view.invalidate()]
]) {
  for (const stage of ['review', 'preview', 'decision']) test(`${name} invalidates ${stage} callback and erases private body`, async () => {
    const pending = deferred(), started = deferred(), view = screen(({ kind, reply }) => {
      if (kind !== stage) return reply(); started.resolve(); return pending.promise;
    });
    let task;
    if (stage === 'decision') { await view.load(); checkAll(view); task = view.decide('approve'); }
    else task = view.load();
    await started.promise;
    const request = view.calls.at(-1); change(view); view.syncContext(); assertCleared(view);
    pending.resolve(response(stage === 'review' ? review() : stage === 'preview' ? preview() : receipt()));
    assert.equal(await task, false); assertCleared(view); assert.equal(request.options.signal.aborted, true);
    assert.equal(view.calls.length, stage === 'review' ? 1 : stage === 'preview' ? 2 : 3);
  });
}

test('cross-owner callbacks never settle another owner; original owner can manually reconcile after returning', async () => {
  const pending = deferred(); let attempts = 0;
  const view = screen(({ kind, reply }) => kind === 'decision' ? ++attempts === 1 ? pending.promise : response(receipt(id(1), 'ko', { idempotentReplay: true })) : reply());
  await view.load(); checkAll(view); const task = view.decide('approve');
  view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext(); assert.equal(view.snapshot().unresolved, false);
  await view.load(); assert.equal(view.snapshot().canRetry, false);
  pending.resolve(response(receipt())); await task;
  assert.equal(view.snapshot().receipt, null); assert.equal(view.snapshot().unresolved, false);
  view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext(); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1], 3); assert.equal(view.keys(), 1);
});

test('late owner A rejection cannot retire owner B command; verified A retirement remains owner-separated', async () => {
  const delayed = deferred(); let attemptsA = 0, attemptsB = 0;
  const view = screen(({ kind, url, options, reply }) => {
    if (kind !== 'decision') return reply();
    if (options.identity.ownerId === id(8)) return ++attemptsA === 1 ? delayed.promise : rejection(rejectionCode('HEAD_CHANGED'), url);
    if (++attemptsB === 1) throw new TypeError('B receipt lost');
    return response(receipt(id(1), 'ko', { idempotentReplay: true }));
  });
  await view.load(); checkAll(view); const taskA = view.decide('approve'), firstA = posts(view)[0];
  view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext();
  await view.load(); checkAll(view); await view.decide('approve'); assertUncertain(view); const firstB = posts(view)[1];
  delayed.resolve(rejection(rejectionCode('HEAD_CHANGED'), firstA.url)); assert.equal(await taskA, false);
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true); assert.equal(view.calls.length, 6);
  view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext(); assert.equal(view.snapshot().canRetry, true);
  await view.retry(); assertReplay(firstA, posts(view)[2], 3); assert.equal(view.snapshot().unresolved, false);
  assert.equal(view.snapshot().canLoad, true); assert.equal(view.keys(), 2);
  view.set.owner({ ownerId: id(9), epoch: 4 }); view.syncContext(); assertUncertain(view);
  assert.equal(await view.retry(), true); const replayB = posts(view)[3];
  assert.equal(replayB.url, firstB.url); assert.equal(replayB.options.body, firstB.options.body);
  assert.equal(replayB.options.headers['Idempotency-Key'], firstB.options.headers['Idempotency-Key']);
  assert.deepEqual(clone(replayB.options.identity), { ownerId: id(9), epoch: 4 }); assert.equal(view.keys(), 2);
});

test('late rejection cannot retire a newer same-owner command after the old key was reconciled', async () => {
  const oldResponse = deferred(), newResponse = deferred(); let attempts = 0;
  const view = screen(({ kind, reply }) => {
    if (kind !== 'decision') return reply();
    const number = ++attempts;
    if (number === 1) return oldResponse.promise;
    if (number === 3) return newResponse.promise;
    return response(receipt(id(1), 'ko', { idempotentReplay: true }));
  });
  await view.load(); checkAll(view); const oldTask = view.decide('approve'); view.invalidate();
  assert.equal(await view.retry(), true); checkAll(view); const newTask = view.decide('approve');
  oldResponse.resolve(rejection(rejectionCode('HEAD_CHANGED'), posts(view)[0].url)); assert.equal(await oldTask, false);
  assert.equal(view.snapshot().unresolved, true); assert.equal(view.snapshot().busy, true); assert.equal(posts(view).length, 3);
  newResponse.reject(new TypeError('New receipt lost')); await newTask; assertUncertain(view);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[2], posts(view)[3]); assert.equal(view.keys(), 2);
});

test('auth change during structured rejection reading invalidates retirement and preserves the original key', async () => {
  const reading = deferred(), payload = deferred(); let attempts = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind !== 'decision') return reply();
    if (++attempts > 1) return response(receipt(id(1), 'ko', { idempotentReplay: true }));
    return response(null, 409, { text: async () => { reading.resolve(); return payload.promise; } });
  });
  await view.load(); checkAll(view); const task = view.decide('approve'); await reading.promise;
  view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext(); assertCleared(view); assert.equal(view.snapshot().unresolved, false);
  payload.resolve(JSON.stringify(rejectionBody(rejectionCode('HEAD_CHANGED'), posts(view)[0].url)));
  assert.equal(await task, false); assert.equal(view.calls.length, 3);
  view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext(); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], posts(view)[1], 3); assert.equal(view.keys(), 1);
});

for (const [name, change, restore] of [
  ['work', view => view.set.work(id(9)), view => view.set.work(id(1))],
  ['source', view => view.set.source('en'), view => view.set.source('ko')],
  ['epoch', view => view.set.owner({ ownerId: id(8), epoch: 2 }), view => view.set.owner({ ownerId: id(8), epoch: 3 })]
]) test(`late definitive rejection after ${name} switch cannot discard the original uncertain key`, async () => {
  const delayed = deferred(); let attempts = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind !== 'decision') return reply();
    return ++attempts === 1 ? delayed.promise : rejection(rejectionCode('SOURCE_CHANGED'), url);
  });
  await view.load(); checkAll(view); const task = view.decide('approve'); change(view); view.syncContext(); assertCleared(view);
  delayed.resolve(rejection(rejectionCode('SOURCE_CHANGED'), posts(view)[0].url)); assert.equal(await task, false);
  assert.equal(view.snapshot().unresolved, true); restore(view); view.syncContext(); assert.equal(view.snapshot().canRetry, true);
  await view.retry(); assertReplay(posts(view)[0], posts(view)[1], name === 'epoch' ? 3 : 1);
  assert.equal(view.snapshot().unresolved, false); assert.equal(view.keys(), 1);
});

test('work/source switches retain unresolved command but block new decisions until original scope reconciliation', async () => {
  const view = screen(({ kind, reply }) => kind === 'decision' ? Promise.reject(new Error('Lost')) : reply());
  await view.load(); checkAll(view); await view.decide('approve');
  view.set.work(id(9)); view.set.source('en'); view.syncContext();
  assert.equal(view.snapshot().messageKey, 'unresolvedElsewhere'); assert.equal(view.snapshot().canRetry, false);
  await view.load(); assert.equal(view.snapshot().canReview, false); assert.equal(await view.retry(), false);
  view.set.work(id(1)); view.set.source('ko'); view.syncContext(); assert.equal(view.snapshot().canRetry, true);
  await view.retry(); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

test('destroy erases body and rejects late callbacks, while replacement controller can reconcile same key', async () => {
  const pending = deferred(); let attempts = 0;
  const view = screen(({ kind, reply }) => kind === 'decision' ? ++attempts === 1 ? pending.promise : response(receipt(id(1), 'ko', { idempotentReplay: true })) : reply());
  await view.load(); checkAll(view); const task = view.decide('approve'); view.destroy();
  assertCleared(view); assert.equal(await view.load(), false); assert.equal(await view.retry(), false);
  const replacement = view.api.createController(view.options); assert.equal(replacement.snapshot().canRetry, true);
  pending.resolve(response(receipt())); assert.equal(await task, false);
  assert.equal(await replacement.retry(), true); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

test('rapid duplicate decisions, retries and loads cannot dispatch duplicate commands', async () => {
  const pending = deferred(), view = screen(({ kind, reply }) => kind === 'decision' ? pending.promise : reply());
  await view.load(); checkAll(view); const ticket = view.snapshot().ticket, task = view.decide('approve', ticket);
  assert.equal(await view.decide('approve', ticket), false); assert.equal(await view.retry(), false); assert.equal(await view.load(), false);
  assert.equal(posts(view).length, 1); pending.reject(new Error('Lost')); await task;
  const retry = view.retry(); assert.equal(await view.retry(), false); await retry;
  assert.equal(posts(view).length, 2); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

test('stale action tickets and reentrant dispatch/key callbacks cannot dispatch cross-scope', async () => {
  let view;
  view = screen(undefined, { onDispatch: () => view.invalidate() });
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), false);
  assertCleared(view); assert.equal(posts(view).length, 0); assert.equal(view.snapshot().canRetry, true);
  let keyed;
  keyed = screen(undefined, { makeIdempotencyKey: () => { keyed.set.owner({ ownerId: id(9), epoch: 2 }); return 'valid-key-123'; } });
  await keyed.load(); checkAll(keyed); assert.equal(await keyed.decide('approve'), false);
  assertCleared(keyed); assert.equal(posts(keyed).length, 0); assert.equal(keyed.snapshot().unresolved, false);
  const clean = screen(); await clean.load(); const oldTicket = clean.snapshot().ticket; clean.invalidate(); await clean.load();
  assert.equal(clean.setReviewed('styleReviewed', true, oldTicket), false); checkAll(clean);
  assert.equal(await clean.decide('approve', oldTicket), false); assert.equal(posts(clean).length, 0);
});

for (const key of ['short', 'x'.repeat(121), 'unsafe key!', '\r\ninjected', null, 123]) test(`unsafe idempotency key never dispatches: ${String(key).slice(0, 16)}`, async () => {
  const view = screen(undefined, { makeIdempotencyKey: () => key }); await view.load(); checkAll(view);
  assert.equal(await view.decide('approve'), false); assert.equal(posts(view).length, 0); assertCleared(view);
});

test('default key and injected preview parser are supported', async () => {
  const { vm } = library(); let parsed = 0;
  const view = screen(undefined, { defaultKey: true, parsePreview: (value, target) => { parsed++; return vm.window.LuminaCreatorBodyPreview.parsePreview(value, target); } });
  await view.load(); checkAll(view); await view.decide('approve');
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], id(90)); assert.equal(parsed, 2);
});

for (const [status, message] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'notFound'], [409, 'conflict'], [500, 'server'], [202, 'unavailable']]) {
  test(`GET ${status} clears body without displaying diagnostics`, async () => {
    const view = screen(() => response({ secret: 'Do not display' }, status));
    assert.equal(await view.load(), false); assertCleared(view); assert.equal(view.snapshot().messageKey, message);
    assert.equal(view.calls.length, 1); assert.doesNotMatch(JSON.stringify(view.snapshot()), /Do not display/);
  });
}

test('null, malformed JSON, missing readers and unknown response shapes fail closed', async () => {
  for (const value of [response(null), response([]), response(null, 200, { text: async () => '{bad' }), { status: 200 }, { status: '200' }, null]) {
    const view = screen(() => value); assert.equal(await view.load(), false); assertCleared(view); assert.equal(view.calls.length, 1);
  }
});

test('bounded response readers reject oversized text, content length and invalid UTF-8', async () => {
  const payloads = [response({}, 200, { headers: { get: () => '999999999' } }),
    response({}, 200, { text: async () => 'x'.repeat(16385) }), response({}, 200, { text: async () => '\uD55C'.repeat(8000) }),
    response({}, 200, { body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } }) })];
  for (const payload of payloads) {
    const view = screen(() => payload); assert.equal(await view.load(), false); assertCleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  }
});

test('scope change while reading streamed private preview cancels and never restores body', async () => {
  const chunk = deferred(), reading = deferred(); let cancelled = false;
  const body = { getReader: () => ({ read: () => { reading.resolve(); return chunk.promise; }, cancel: async () => { cancelled = true; }, releaseLock() {} }) };
  const view = screen(({ kind, reply }) => kind === 'preview' ? response(null, 200, { body }) : reply());
  const task = view.load();
  await reading.promise; view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext();
  chunk.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(preview())) });
  assert.equal(await task, false); assert.equal(cancelled, true); assertCleared(view);
});

test('failed refresh after receipt cannot show that historical receipt as applicable approval', async () => {
  let accepted = false;
  const view = screen(({ kind, reply }) => {
    if (kind === 'decision') { accepted = true; return response(receipt(id(1), 'ko', { idempotentReplay: true })); }
    if (kind === 'review' && accepted) return response({}, 500);
    return reply();
  });
  await view.load(); checkAll(view); assert.equal(await view.decide('approve'), true);
  assert.equal(view.snapshot().data, null); assert.equal(view.snapshot().receipt.idempotentReplay, true);
  assert.equal(view.snapshot().canApprove, false); assert.equal(view.snapshot().unresolved, false);
});

class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.style = {}; this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this._text = '';
    const classes = new Set(); this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback)); }
  fire(type, event = {}) { let result; for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
function mounted(handler = ({ reply }) => reply(), settings = {}) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell');
  const section = new Element('section', 'writer-manuscript'), host = new Element('section', 'writerBodyReview');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, work, sourceLocale, ...(settings.autoMount ? [host] : [])].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', token = 'existing-access-token', refreshAttempts = 0;
  const calls = [], observers = [], events = []; window.crypto = { randomUUID: () => id(90) };
  window.getAuth = () => ({ accessToken: token, refreshToken: 'must-not-use' }); window.luminaI18n = { getLocale: () => language };
  window.dispatchEvent = event => { events.push(event.type); window.fire(event.type); return true; };
  const fetch = async (url, options) => {
    if (!options.token || !options._retried) refreshAttempts++;
    const kind = options.method === 'POST' ? url.endsWith('/withdraw') ? 'withdraw' : 'decision' : url.includes('/body-review') ? 'review' : 'preview';
    const target = { workId: work.value, locale: sourceLocale.value }, call = { url, options, kind }; calls.push(call);
    const reply = () => response(kind === 'review' ? review(target.workId, target.locale) : kind === 'preview' ? preview(target.workId, target.locale)
      : receipt(target.workId, target.locale, { review: row({ locale: target.locale,
        ...(kind === 'decision' ? Object.fromEntries(['decision', ...fields].map(key => [key, options.body[key]]))
          : { withdrawnAt: '2026-10-03T02:00:00Z', applicability: 'withdrawn' }) }) }));
    return handler({ ...call, target, calls, reply });
  };
  window.LuminaCreatorStudioApi = { identity: () => owner,
    isCurrent: value => owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch, fetch };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; }
    observe(target, options) { observers.push({ target, options, observer: this }); }
    disconnect() { this.disconnected = true; }
  }
  class Event { constructor(type) { this.type = type; } }
  const { api } = library({ window, document, MutationObserver, Event });
  const controller = settings.autoMount ? null : api.mount(host, settings); assert.equal(api.mount(host), null);
  const button = name => walk(host).find(node => node.id === `writerBodyReview${name}`);
  return { window, document, shell, section, host, work, sourceLocale, api, controller, calls, observers, events, button,
    load: () => button('Refresh').fire('click'), retry: () => button('Retry').fire('click'),
    check: field => { const input = walk(host).find(node => node.name === field); input.checked = true; return input.fire('change'); },
    setOwner: value => { owner = value; }, setToken: value => { token = value; }, locale: value => { language = value; },
    refreshAttempts: () => refreshAttempts,
    mutate: target => { for (const item of observers.filter(item => item.target === target && !item.observer.disconnected)) item.observer.callback([{ type: 'attributes' }]); }
  };
}

test('mount is idle; existing token and no-retry options prevent auth refresh and POST retries', async () => {
  const view = mounted(); assert.equal(view.calls.length, 0); assert.equal(view.button('Retry').hidden, true);
  for (const name of ['focus', 'pageshow', 'storage', 'lumina:authchange']) view.window.fire(name);
  assert.equal(view.calls.length, 0); await view.load();
  for (const field of fields) view.check(field); assert.equal(posts(view).length, 0);
  await view.button('Approve').fire('click'); assert.equal(posts(view).length, 1);
  assert.deepEqual(clone(posts(view)[0].options.body), expectedBody);
  for (const { options } of view.calls) { assert.equal(options.token, 'existing-access-token'); assert.equal(options._retried, true); }
  assert.equal(view.refreshAttempts(), 0); assert.deepEqual(view.events, ['lumina:author-body-review-changed']);
  view.setToken(null); await view.load(); assert.equal(view.refreshAttempts(), 0); assert.doesNotMatch(view.host.textContent, /Private generated/);
});

test('default root auto-mounts once by ID, stays idle and uses the shared API after explicit click', async () => {
  const view = mounted(undefined, { autoMount: true });
  assert.equal(view.host.dataset.bodyReviewMounted, 'true'); assert.equal(view.calls.length, 0);
  assert.equal(walk(view.host).filter(node => node.id === 'writerBodyReviewTitle').length, 1);
  await view.load(); assert.equal(view.calls.length, 2); assert.match(view.host.textContent, /Private generated body/);
  assert.equal(view.calls[0].options.token, 'existing-access-token'); assert.equal(view.refreshAttempts(), 0);
});

test('mount renders private text literally with no executable nodes; check changes never approve', async () => {
  const attack = '<img src=x onerror=attack()><script>steal()</script><a href="javascript:steal()">open</a>';
  const view = mounted(({ kind, reply }) => {
    if (kind !== 'preview') return reply(); const value = preview(); value.progress.scene.title = attack; value.progress.scene.beats[0].content = attack; return response(value);
  });
  await view.load(); for (const field of fields) view.check(field);
  assert.ok(view.host.textContent.includes(attack)); assert.equal(posts(view).length, 0);
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'A', 'IFRAME'].includes(node.tagName)).length, 0);
  assert.equal(walk(view.host).find(node => node.className === 'body-review-beat').style.whiteSpace, 'pre-wrap');
  assert.equal(walk(view.host).find(node => node.className === 'body-review-source').lang, 'ko');
  assert.equal(view.button('Approve').disabled, false); assert.equal(view.button('Reject').disabled, false);
});

for (const language of locales) test(`localized ${language} scope/checkboxes/statuses retain Japanese source locale`, async () => {
  const view = mounted(); view.locale(language); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change'); await view.load();
  const words = view.api.copy[language]; assert.equal(view.host.lang, language);
  for (const key of Object.keys(view.api.copy.en)) assert.equal(typeof words[key], 'string', key);
  assert.equal(view.button('Refresh').title, words.refresh); assert.equal(view.button('Retry').getAttribute('aria-label'), words.retry);
  assert.equal(view.button('Approve').textContent, words.approve); assert.equal(view.button('Reject').textContent, words.reject);
  assert.ok(view.host.textContent.includes(words.privacy));
  for (const field of fields) assert.ok(view.host.textContent.includes(words[field]));
  assert.equal(walk(view.host).find(node => node.className === 'body-review-source').lang, 'ja');
  assert.ok(view.calls.every(call => call.url.endsWith('?locale=ja'))); assert.equal(posts(view).length, 0);
});

for (const language of locales) test(`source_changed ${language} hides private body, preserves old-locale stale withdrawal`, async () => {
  const value = review(id(1), 'ko', { state: 'source_changed', target: null, latestReview: row({ locale: 'ja', applicability: 'stale' }) });
  const view = mounted(({ kind, reply }) => kind === 'review' ? response(value) : kind === 'withdraw' ? response(receipt(id(1), 'ja', {
    review: row({ locale: 'ja', withdrawnAt: '2026-10-03T02:00:00Z', applicability: 'withdrawn' }) })) : reply());
  view.locale(language); view.window.fire('lumina:localechange'); await view.load();
  assert.equal(view.button('Approve').hidden, true); assert.equal(view.button('Reject').hidden, true);
  assert.equal(view.button('Withdraw').disabled, false); assert.doesNotMatch(view.host.textContent, /Private generated/);
  assert.ok(view.host.textContent.includes(view.api.copy[language].source_changed));
  assert.ok(view.host.textContent.includes(view.api.copy[language].stale));
  await view.button('Withdraw').fire('click'); assert.equal(posts(view)[0].options.body && Object.keys(posts(view)[0].options.body).length, 0);
  assert.equal(view.controller.snapshot().receipt.locale, 'ja');
});

test('historical replay cannot be rendered as current approval; refresh failure leaves only generic receipt status', async () => {
  let accepted = false;
  const view = mounted(({ kind, reply }) => {
    if (kind === 'decision') { accepted = true; return response(receipt(id(1), 'ko', { idempotentReplay: true })); }
    if (kind === 'review' && accepted) return response({}, 500);
    return reply();
  });
  view.locale('en'); view.window.fire('lumina:localechange'); await view.load(); for (const field of fields) view.check(field);
  await view.button('Approve').fire('click');
  assert.ok(view.host.textContent.includes(view.api.copy.en.receipt));
  assert.equal(walk(view.host).some(node => node.className === 'body-review-latest'), false);
  assert.doesNotMatch(view.host.textContent, /Current body review|Approved|Private generated/);
});

test('mount forwards lost POST manual retry with the identical structured body and key', async () => {
  let attempts = 0;
  const view = mounted(({ kind, reply }) => {
    if (kind !== 'decision') return reply();
    if (++attempts === 1) throw new TypeError('Lost receipt'); return response(receipt(id(1), 'ko', { idempotentReplay: true }));
  });
  await view.load(); for (const field of fields) view.check(field); await view.button('Approve').fire('click');
  assert.equal(view.button('Retry').hidden, false); assert.equal(view.button('Retry').disabled, false); assert.equal(posts(view).length, 1);
  await view.retry(); assert.equal(view.button('Retry').hidden, true);
  assert.deepEqual(clone(posts(view)[0].options.body), expectedBody); assert.deepEqual(clone(posts(view)[1].options.body), expectedBody);
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(view.refreshAttempts(), 0); assert.equal(posts(view).length, 2);
});

for (const name of ['SOURCE_CHANGED', 'HEAD_CHANGED']) test(`default mount preserves structured ${name} through shared transport and resumes on manual refresh`, async () => {
  let attempts = 0, keyCount = 0;
  const view = mounted(({ kind, url, reply }) => kind === 'decision' && ++attempts === 1 ? rejection(rejectionCode(name), url) : reply(),
    { makeIdempotencyKey: () => `mounted-review-${++keyCount}` });
  await view.load(); for (const field of fields) view.check(field); await view.button('Approve').fire('click');
  assert.equal(view.controller.snapshot().unresolved, false); assert.equal(view.button('Retry').hidden, true);
  assert.equal(view.button('Refresh').disabled, false); assert.equal(view.calls.length, 3);
  assert.doesNotMatch(view.host.textContent, /PRIVATE_DIAGNOSTIC|private-request-id|STORY_AUTHOR_BODY_REVIEW/);
  await view.load(); assert.equal(view.button('Approve').disabled, true); assert.equal(posts(view).length, 1);
  for (const field of fields) view.check(field); await view.button('Approve').fire('click'); assert.equal(posts(view).length, 2);
  assert.deepEqual(clone(posts(view)[1].options.body), expectedBody);
  assert.notEqual(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(view.refreshAttempts(), 0); assert.equal(keyCount, 2);
});

test('mounted other-tab withdrawal refreshes to a withdrawn old-locale head without retry or approval', async () => {
  let withdrawnElsewhere = false;
  const view = mounted(({ kind, url, reply }) => {
    if (kind === 'review') return response(review(id(1), 'ko', { state: 'source_changed', target: null,
      latestReview: row({ locale: 'ja', applicability: withdrawnElsewhere ? 'withdrawn' : 'stale',
        withdrawnAt: withdrawnElsewhere ? '2026-10-04T02:00:00Z' : null }) }));
    if (kind === 'withdraw') { withdrawnElsewhere = true; return rejection(rejectionCode('ALREADY_WITHDRAWN'), url); }
    return reply();
  });
  await view.load(); await view.button('Withdraw').fire('click'); assert.equal(view.controller.snapshot().unresolved, false);
  assert.equal(view.calls.length, 3); assert.equal(view.button('Retry').hidden, true); assert.equal(view.button('Refresh').disabled, false);
  await view.load(); assert.equal(view.button('Withdraw').hidden, true); assert.equal(view.button('Approve').hidden, true);
  assert.equal(view.controller.snapshot().data.review.latestReview.locale, 'ja'); assert.equal(posts(view).length, 1);
  assert.equal(view.controller.snapshot().receipt, null); assert.equal(view.refreshAttempts(), 0);
});

test('mounted unconfirmed transport outcome retains exact structured body and key for manual retry', async () => {
  let attempts = 0;
  const view = mounted(({ kind, url, reply }) => {
    if (kind !== 'decision') return reply();
    if (++attempts === 1) return rejection(rejectionCode('OUTCOME_UNCONFIRMED'), url, 503);
    return response(receipt(id(1), 'ko', { idempotentReplay: true }));
  });
  await view.load(); for (const field of fields) view.check(field); await view.button('Approve').fire('click');
  assert.equal(view.controller.snapshot().unresolved, true); assert.equal(view.button('Retry').disabled, false); assert.equal(view.calls.length, 3);
  assert.doesNotMatch(view.host.textContent, /PRIVATE_DIAGNOSTIC|private-request-id|OUTCOME_UNCONFIRMED/);
  await view.retry(); assert.equal(posts(view).length, 2);
  assert.deepEqual(clone(posts(view)[0].options.body), clone(posts(view)[1].options.body));
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(view.refreshAttempts(), 0);
});

for (const name of ['work', 'source', 'authchange', 'expired-window', 'expired-document', 'storage', 'pagehide', 'tab-click',
  'hidden-shell', 'hidden-section', 'hidden-host', 'visibility', 'language', 'trial-progress']) test(`mounted private DOM clears on ${name}`, async () => {
  const view = mounted(); await view.load(); for (const field of fields) view.check(field);
  if (name === 'work') { view.work.value = id(9); view.work.fire('change'); }
  if (name === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('input'); }
  if (name === 'authchange') view.window.fire('lumina:authchange');
  if (name === 'expired-window') view.window.fire('lumina:auth-expired');
  if (name === 'expired-document') view.document.fire('lumina:auth-expired');
  if (name === 'storage') view.window.fire('storage');
  if (name === 'pagehide') view.window.fire('pagehide');
  if (name === 'trial-progress') view.window.fire('lumina:author-body-trial-progress-changed');
  if (name === 'tab-click') { const tab = new Element('button'); tab.setAttribute('data-section', 'other'); view.document.fire('click', { target: tab }); }
  if (name === 'hidden-shell') { view.shell.hidden = true; view.mutate(view.shell); }
  if (name === 'hidden-section') { view.section.classList.remove('is-active'); view.mutate(view.section); }
  if (name === 'hidden-host') { view.host.hidden = true; view.mutate(view.host); }
  if (name === 'visibility') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
  if (name === 'language') { view.locale('en'); view.window.fire('lumina:localechange'); }
  assert.doesNotMatch(view.host.textContent, /Private generated|Exact spacing/); assert.equal(view.button('Approve').disabled, true);
  await view.button('Approve').fire('click'); assert.equal(posts(view).length, 0);
});

test('hide/show within one task invalidates pending GET', async () => {
  const pending = deferred(), view = mounted(() => pending.promise), task = view.load();
  view.section.classList.remove('is-active'); view.section.classList.add('is-active'); view.mutate(view.section);
  pending.resolve(response(review())); await task;
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.signal.aborted, true); assert.doesNotMatch(view.host.textContent, /Private generated/);
});

test('mount options support independent hosts and clean up listeners/observers on destroy', async () => {
  let dispatches = 0;
  const owner = { ownerId: id(8), epoch: 1 };
  const view = mounted(undefined, { identity: () => owner, isCurrent: value => value.ownerId === owner.ownerId,
    context: () => ({ workId: id(1), locale: 'en' }), locale: () => 'en', visible: () => true,
    fetch: async (url, options) => response(options.method === 'POST' ? receipt(id(1), 'en') : url.includes('/body-review') ? review(id(1), 'en') : preview(id(1), 'en')),
    onDispatch: () => { dispatches++; } });
  await view.load(); assert.equal(view.host.lang, 'en'); for (const field of fields) view.check(field); await view.button('Approve').fire('click');
  assert.equal(dispatches, 1); assert.equal(view.calls.length, 0);
  const refresh = view.button('Refresh'); view.controller.destroy(); assert.equal(view.host.children.length, 0);
  assert.ok(view.observers.every(item => item.observer.disconnected)); await refresh.fire('click');
  assert.equal(view.host.children.length, 0); assert.equal(view.host.dataset.bodyReviewMounted, undefined);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspect } from 'node:util';
import vm from 'node:vm';

const source = readFileSync(new URL('../pages/mypage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function excerpt(start, end) {
  assert.equal(source.split(start).length, 2, `Unique actual-source start: ${start}`);
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(last > first, `Actual-source end: ${end}`);
  return source.slice(first, last);
}

const actualSource = [
  excerpt('function setMypageText(', 'function setMypageInput('),
  excerpt('function updateMypageProfilePreview(', '\n/*'),
  excerpt('const MYPAGE_AVATAR_ALLOWED =', 'function bindMypageAvatarUpload('),
  excerpt('async function handleMypageAvatarSelect(', 'async function uploadMypageAvatar('),
  excerpt('async function uploadMypageAvatar(', '\n/* #192')
].join('\n');

const fixture = {
  secret: 'SYNTHETIC-AVATAR-SECRET-ONLY',
  email: 'avatar-owner@synthetic.invalid',
  userId: 'synthetic-avatar-user-id',
  assetId: 'synthetic-avatar-initial-asset-id',
  finalAssetId: 'synthetic-avatar-confirmed-asset-id',
  uploadUrl: 'https://upload.synthetic.invalid/avatar?signature=SYNTHETIC-AVATAR-SECRET-ONLY',
  finalUrl: 'https://media.synthetic.invalid/private-avatar-final',
  previousUrl: 'https://media.synthetic.invalid/private-avatar-previous',
  blobUrl: 'blob:https://synthetic.invalid/private-avatar-preview',
  errorMessage: 'SYNTHETIC-AVATAR-PRIVATE-ERROR-MESSAGE',
  errorBody: 'SYNTHETIC-AVATAR-PRIVATE-ERROR-BODY'
};

function element() {
  const classes = new Set();
  return {
    textContent: '',
    style: { backgroundImage: '' },
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle(value, force) {
        const next = force === undefined ? !classes.has(value) : !!force;
        if (next) classes.add(value);
        else classes.delete(value);
        return next;
      }
    }
  };
}

function makeHarness({ mode = 'metadata_only', failure = null, status = 503, wrapped = true, confirmedId = true, abort = false } = {}) {
  const nodes = Object.fromEntries([
    'mypageAvatar', 'mypageProfilePreviewInitial', 'mypageProfilePreview', 'mypageAvatarStatus'
  ].map(id => [id, element()]));
  const logs = [];
  const calls = [];
  const timers = [];
  const revoked = [];
  const created = [];
  const authWrites = [];
  const sync = { menu: 0, feed: 0 };
  const file = { name: 'synthetic-avatar.png', type: 'image/png', size: 2048 };
  let auth = {
    accessToken: fixture.secret,
    user: { id: fixture.userId, email: fixture.email, displayName: 'Synthetic Owner', avatarUrl: fixture.previousUrl, retainedField: 'unchanged' }
  };
  const finalAsset = { ...(confirmedId ? { id: fixture.finalAssetId } : {}), url: fixture.finalUrl };
  const updatedUser = { id: fixture.userId, email: fixture.email, displayName: 'Synthetic Updated Owner', avatarAsset: finalAsset };
  const intent = {
    asset: { id: fixture.assetId },
    upload: { mode, url: fixture.uploadUrl, method: 'PUT', requiredHeaders: { 'x-synthetic-signature': fixture.secret } }
  };

  function privateError() {
    const error = new Error(fixture.errorMessage);
    error.status = status;
    error.body = { marker: fixture.errorBody, token: fixture.secret, user: { id: fixture.userId, email: fixture.email }, assetId: fixture.assetId, url: fixture.uploadUrl };
    if (abort) error.name = 'AbortError';
    return error;
  }

  function record(kind, path, options) {
    calls.push({ kind, path, options });
  }

  const context = vm.createContext({
    document: { getElementById: id => nodes[id] ?? null },
    console: Object.fromEntries(['info', 'error', 'warn', 'log', 'debug'].map(level => [level, (...args) => logs.push({ level, args })])),
    URL: {
      createObjectURL(value) { assert.equal(value, file); created.push(value); return fixture.blobUrl; },
      revokeObjectURL(value) { revoked.push(value); }
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    getAuth: () => auth,
    setAuth(value) { auth = value; authWrites.push(value); },
    syncUserMenuAvatar() { sync.menu += 1; },
    syncFeedComposeAvatar() { sync.feed += 1; },
    async apiFetch(path, options) {
      assert.equal(options.auth, true);
      assert.equal(options.throwOnError, true);
      record('api', path, options);
      if (path === '/api/v1/me/assets/upload-intents') {
        assert.equal(options.method, 'POST');
        assert.equal(calls.length, 1);
        assert.equal(options.body.fileName, file.name);
        assert.equal(options.body.mimeType, file.type);
        assert.equal(options.body.fileSizeBytes, file.size);
        if (failure === 'intent') throw privateError();
        if (failure === 'invalid-asset') return { upload: intent.upload, body: privateError().body };
        if (failure === 'invalid-upload') return { asset: intent.asset, body: privateError().body };
        return intent;
      }
      if (path === `/api/v1/me/assets/${encodeURIComponent(fixture.assetId)}/confirm-upload`) {
        assert.equal(options.method, 'POST');
        assert.equal(Object.keys(options.body).length, 0);
        if (failure === 'confirm') throw privateError();
        return wrapped ? { asset: finalAsset } : finalAsset;
      }
      assert.equal(path, '/api/v1/me/profile', 'Only exact synthetic avatar endpoints are admitted');
      assert.equal(options.method, 'PATCH');
      assert.equal(Object.keys(options.body).length, 1);
      assert.equal(options.body.avatarAssetId, confirmedId ? fixture.finalAssetId : fixture.assetId);
      if (failure === 'patch') throw privateError();
      return wrapped ? { user: updatedUser } : updatedUser;
    },
    async fetch(url, options) {
      assert.equal(url, fixture.uploadUrl, 'No real URL can enter this memory transport');
      assert.equal(mode, 'direct_upload_ready');
      assert.equal(options.method, 'PUT');
      assert.equal(options.body, file);
      assert.equal(options.headers['x-synthetic-signature'], fixture.secret);
      record('put', url, options);
      if (failure === 'put-throw') throw privateError();
      return { ok: failure !== 'put-status', status: failure === 'put-status' ? status : 200 };
    }
  });
  // Actual handlers and preview/status helpers; transport, DOM, auth storage and timers are lexical memory fixtures.
  vm.runInContext(actualSource, context, { filename: 'mypage-avatar-actual-excerpts.js' });
  return {
    context, nodes, logs, calls, timers, revoked, created, authWrites, sync, file, updatedUser,
    get auth() { return auth; },
    upload: () => context.uploadMypageAvatar(file),
    select: () => context.handleMypageAvatarSelect(file),
    flushTimers(through) {
      const ready = timers.filter(timer => timer.delay <= through).sort((a, b) => a.delay - b.delay);
      for (const timer of ready) { timers.splice(timers.indexOf(timer), 1); timer.callback(); }
    }
  };
}

function assertPrivateLogsAbsent(harness) {
  const rendered = inspect(harness.logs, { depth: null, showHidden: true, breakLength: Infinity });
  for (const marker of Object.values(fixture)) {
    assert.ok(!rendered.includes(marker), 'Console exposed a synthetic private marker');
  }
  assert.ok(!harness.logs.some(entry => entry.args.some(value => Object.prototype.toString.call(value) === '[object Error]')), 'Console exposed a raw Error object');
}

function assertSuccess(harness, mode) {
  assert.equal(harness.calls.map(call => call.kind).join(','), mode === 'direct_upload_ready' ? 'api,put,api,api' : 'api,api,api');
  assert.equal(harness.authWrites.length, 1);
  assert.equal(harness.auth.accessToken, fixture.secret);
  assert.equal(harness.auth.user.id, fixture.userId);
  assert.equal(harness.auth.user.email, fixture.email);
  assert.equal(harness.auth.user.retainedField, 'unchanged');
  assert.equal(harness.auth.user.avatarUrl, fixture.finalUrl);
  assert.equal(harness.nodes.mypageProfilePreview.style.backgroundImage, `url('${fixture.finalUrl}')`);
  assert.equal(harness.nodes.mypageProfilePreview.classList.contains('has-image'), true);
  assert.deepEqual(harness.sync, { menu: 1, feed: 1 });
}

function assertFailure(harness, expectedCalls) {
  assert.equal(harness.calls.length, expectedCalls);
  assert.equal(harness.authWrites.length, 0);
  assert.deepEqual(harness.sync, { menu: 0, feed: 0 });
  assert.equal(harness.auth.user.avatarUrl, fixture.previousUrl);
  assert.equal(harness.nodes.mypageProfilePreview.style.backgroundImage, `url('${fixture.previousUrl}')`);
  assert.equal(harness.nodes.mypageProfilePreview.classList.contains('is-error'), true);
  assert.equal(harness.nodes.mypageProfilePreview.classList.contains('is-loading'), false);
  assert.equal(harness.nodes.mypageAvatarStatus.classList.contains('is-error'), true);
  assert.ok(harness.nodes.mypageAvatarStatus.textContent.length > 0);
  for (const marker of [fixture.secret, fixture.email, fixture.userId, fixture.errorMessage, fixture.errorBody, fixture.uploadUrl]) {
    assert.ok(!harness.nodes.mypageAvatarStatus.textContent.includes(marker), 'Status exposed synthetic private diagnostics');
  }
  harness.flushTimers(2000);
  assert.deepEqual(harness.revoked, [fixture.blobUrl]);
}

test('pre-product privacy: metadata success has no private console payload', async () => {
  const h = makeHarness();
  assert.equal(await h.upload(), h.updatedUser);
  assertSuccess(h, 'metadata_only');
  assertPrivateLogsAbsent(h);
});

test('pre-product privacy: intent failure has no private console payload', async () => {
  const h = makeHarness({ failure: 'intent' });
  await h.select();
  assertFailure(h, 1);
  assertPrivateLogsAbsent(h);
});

for (const mode of ['metadata_only', 'direct_upload_ready']) {
  test(`${mode}: selection preserves preview, success, auth and URL cleanup`, async () => {
    const h = makeHarness({ mode });
    await h.select();
    assertSuccess(h, mode);
    assert.equal(h.nodes.mypageProfilePreview.classList.contains('is-success'), true);
    assert.equal(h.nodes.mypageAvatarStatus.classList.contains('is-success'), true);
    assert.deepEqual(h.created, [h.file]);
    assertPrivateLogsAbsent(h);
    h.flushTimers(1600);
    assert.equal(h.nodes.mypageProfilePreview.classList.contains('is-success'), false);
    assert.equal(h.nodes.mypageAvatarStatus.classList.contains('is-info'), true);
    assert.equal(h.nodes.mypageProfilePreview.style.backgroundImage, `url('${fixture.finalUrl}')`);
    assert.equal(h.revoked.length, 0);
    h.flushTimers(2000);
    assert.deepEqual(h.revoked, [fixture.blobUrl]);
  });
}

test('unwrapped confirm/profile responses preserve return and initial asset-ID fallback', async () => {
  const h = makeHarness({ wrapped: false, confirmedId: false });
  assert.equal(await h.upload(), h.updatedUser);
  assertSuccess(h, 'metadata_only');
  assertPrivateLogsAbsent(h);
});

const failures = [
  { failure: 'intent', calls: 1 },
  { failure: 'invalid-asset', calls: 1 },
  { failure: 'invalid-upload', calls: 1 },
  { failure: 'confirm', calls: 2 },
  { failure: 'patch', calls: 3 },
  { failure: 'put-throw', mode: 'direct_upload_ready', calls: 2 },
  { failure: 'put-status', mode: 'direct_upload_ready', calls: 2 }
];

for (const scenario of failures) {
  test(`${scenario.failure}: masked logs, restored preview, no downstream success`, async () => {
    const h = makeHarness(scenario);
    await h.select();
    assertFailure(h, scenario.calls);
    assertPrivateLogsAbsent(h);
  });
}

for (const [status, fragment] of [
  [401, '\ub85c\uadf8\uc778\uc774 \ub9cc\ub8cc'],
  [413, '\uc6a9\ub7c9'],
  [415, '\uc9c0\uc6d0\ud558\uc9c0'],
  [409, '\uc774\ubbf8 \ucc98\ub9ac'],
  [429, '\uc694\uccad\uc774 \ub108\ubb34']
]) {
  test(`status ${status}: existing user copy and log privacy`, async () => {
    const h = makeHarness({ failure: 'intent', status });
    await h.select();
    assertFailure(h, 1);
    assert.ok(h.nodes.mypageAvatarStatus.textContent.includes(fragment), 'Existing status-specific copy is preserved');
    assertPrivateLogsAbsent(h);
  });
}

test('abort failure preserves network advice without raw error logging', async () => {
  const h = makeHarness({ failure: 'intent', abort: true });
  await h.select();
  assertFailure(h, 1);
  assert.ok(h.nodes.mypageAvatarStatus.textContent.includes('\ub124\ud2b8\uc6cc\ud06c'), 'Existing network advice is preserved');
  assertPrivateLogsAbsent(h);
});

for (const [name, change] of [
  ['invalid MIME', { type: 'text/plain' }],
  ['oversized file', { size: 8 * 1024 * 1024 + 1 }]
]) {
  test(`${name}: no transport, blob allocation or auth mutation`, async () => {
    const h = makeHarness();
    Object.assign(h.file, change);
    await h.select();
    assert.equal(h.calls.length, 0);
    assert.equal(h.created.length, 0);
    assert.equal(h.authWrites.length, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(h.nodes.mypageAvatarStatus.classList.contains('is-error'), true);
    assertPrivateLogsAbsent(h);
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browser, graphServer, ids, locales, ok, failure, flush, deferred } from './ott-graph-preview.test-support.mjs';

test('entry rejects mixed, duplicate, malformed identities and insecure/signed-out access', async () => {
  for (const options of [
    { search: `?manifestId=${ids.manifest}&fileId=${ids.A}` },
    { search: `?manifestId=${ids.manifest}&manifestId=${ids.manifest}` },
    { search: `?manifestId=${ids.manifest}&previewId=${ids.preview}` },
    { search: '?manifestId=wrong' }, { search: '?previewId=' }, { signedIn: false }, { protocol: 'http:' }
  ]) { const page = browser(options); await flush(); assert.equal(page.calls.length, 0); assert.equal(page.elements.previewPlayer.hidden, true); }
});

test('explicit manifest entry pins locale, resumes revision and never requests the newest graph', async () => {
  const page = browser({ server: graphServer({ revision: 9, position: 450 }) });
  await flush();
  assert.equal(page.calls.length, 3);
  assert.equal(page.elements.previewPlayer.hidden, false);
  assert.equal(page.choices().length, 3);
  assert.equal(page.commands().length, 0);
  await page.play();
  assert.equal(page.video.currentTime, .45);
  assert.equal(page.video.paused, false);
  assert.ok(page.calls.every(call => call.options.credentials === 'include'));
  assert.ok(page.video.src.includes(`/private-files/${ids.A}/delivery`));
  assert.doesNotMatch(page.video.src, /token|\?/);
});

test('preview entry honors its pinned locale, then explicitly selects a separate locale pin', async () => {
  const server = graphServer();
  const page = browser({ server, locale: 'en', search: `?previewId=${server.pinId('ja')}` });
  await flush();
  assert.equal(page.document.documentElement.lang, 'ja');
  assert.equal(page.calls.length, 2);
  page.elements.previewLocale.value = 'zh-Hant';
  page.elements.previewLocale.fire('change');
  await flush();
  assert.equal(page.document.documentElement.lang, 'zh-Hant');
  assert.match(page.choices()[0].textContent, /選擇/);
  assert.equal(page.commands().length, 0);
});

test('double choice sends one command; B and C use distinct returned file/session paths', async () => {
  for (const target of ['B', 'C']) {
    const page = browser(); await flush();
    const button = page.choices().find(button => button.textContent.endsWith(target));
    button.fire('click'); button.fire('click'); await flush();
    assert.equal(page.commands().length, 1);
    const body = JSON.parse(page.commands()[0].options.body);
    assert.deepEqual(body, { manifestId: ids.manifest, expectedRevision: 0, nodeKey: 'A', choiceKey: target });
    await page.play();
    assert.ok(page.video.src.includes(ids[target]));
    assert.equal(page.video.currentTime, target === 'B' ? .3 : .4);
  }
});

test('server rejoin and ending completion retain the actual applied revisions', async () => {
  const page = browser(); await flush();
  page.choices()[0].fire('click'); await flush();
  page.choices()[0].fire('click'); await flush();
  assert.equal(page.choices().length, 0);
  await page.play();
  page.video.currentTime = 1.8;
  page.video.fire('timeupdate'); await flush();
  assert.equal(page.video.paused, true);
  assert.equal(page.video.currentTime, 1.7);
  assert.equal(page.elements.graphEnding.hidden, false);
  assert.match(page.elements.graphEnding.textContent, /^Completed:/);
  assert.deepEqual(page.commands().map(call => JSON.parse(call.options.body).expectedRevision), [0, 1, 2]);
});

test('completed entry stays completed; explicit replay saves the current scene start only', async () => {
  const page = browser({ server: graphServer({ node: 'D', revision: 8, position: 1700, status: 'completed' }) });
  await flush();
  assert.equal(page.elements.graphEnding.hidden, false);
  assert.equal(page.commands().length, 0);
  await page.play();
  assert.equal(page.commands().length, 1);
  assert.equal(JSON.parse(page.commands()[0].options.body).positionMs, 800);
  assert.equal(page.elements.graphEnding.hidden, true);
});

test('save coalesces pause/seek and timeupdate never periodically writes progress', async () => {
  const page = browser(); await flush(); await page.play();
  for (let i = 0; i < 20; i++) { page.video.currentTime = .2 + i / 1000; page.video.fire('timeupdate'); }
  assert.equal(page.commands().length, 0);
  page.video.currentTime = .3; page.video.pause();
  page.video.currentTime = .4; page.video.fire('seeking'); page.video.fire('seeked');
  page.runTimer(350); await flush();
  assert.equal(page.commands().length, 1);
  assert.equal(JSON.parse(page.commands()[0].options.body).positionMs, 400);
  assert.equal(page.calls.filter(call => /playback-manifests\//.test(call.url) && call.options.method === 'GET').length, 1);
});

test('save in flight blocks choice; next choice uses the save response revision', async () => {
  const pending = deferred(); let held = false;
  const page = browser({ intercept: call => { if (call.url.endsWith('/position') && !held) { held = true; return pending.promise; } } });
  await flush(); await page.play();
  page.video.currentTime = .4; page.video.pause(); page.runTimer(350); await flush();
  assert.ok(page.choices().every(button => button.disabled));
  page.choices()[0].fire('click'); assert.equal(page.commands().length, 1);
  pending.resolve(page.server.handle(page.commands()[0])); await flush();
  page.choices()[0].fire('click'); await flush();
  assert.equal(JSON.parse(page.commands()[1].options.body).expectedRevision, 1);
});

test('lost acknowledgement reconciles committed choice without resending or guessing a target', async () => {
  let lost = false;
  const page = browser({ intercept: (call, server) => { if (call.url.endsWith('/choices') && !lost) { lost = true; server.handle(call); throw new Error('lost acknowledgement'); } } });
  await flush(); page.choices()[0].fire('click'); await flush();
  assert.match(page.elements.graphSaveState.textContent, /unknown/);
  assert.equal(page.elements.previewStart.disabled, true);
  assert.equal(page.storage.size, 1);
  page.elements.previewRetry.fire('click'); await flush();
  assert.equal(page.commands().length, 1);
  assert.equal(page.storage.size, 0);
  await page.play(); assert.ok(page.video.src.includes(ids.B));
});

test('uncommitted timeout explicitly retries an identical key and body, including after reload', async () => {
  const server = graphServer(); const storage = new Map(); let lost = false;
  const first = browser({ server, storage, intercept: call => { if (call.url.endsWith('/choices') && !lost) { lost = true; throw new Error('timeout'); } } });
  await flush(); first.choices()[1].fire('click'); await flush();
  const original = first.commands()[0];
  const second = browser({ server, storage }); await flush();
  assert.equal(second.elements.previewStart.disabled, true);
  second.elements.previewRetry.fire('click'); await flush();
  assert.equal(second.commands()[0].options.headers['Idempotency-Key'], original.options.headers['Idempotency-Key']);
  assert.equal(second.commands()[0].options.body, original.options.body);
  assert.equal(server.receipts.size, 1);
});

test('old successful replay reads current progress instead of restoring historical branch', async () => {
  const server = graphServer(); let lost = false; let receipt;
  const page = browser({ server, intercept: call => {
    if (call.url.endsWith('/choices') && !lost) { lost = true; receipt = JSON.parse(call.options.body); throw new Error('unknown'); }
    if (call.url.endsWith('/choices') && lost) {
      const old = server.projection('en', { node: 'B', revision: receipt.expectedRevision + 1, positionMs: 300, status: 'active' });
      server.states.set('en', { node: 'D', revision: 5, positionMs: 900, status: 'active' });
      return ok({ ...old, idempotentReplay: true });
    }
  } });
  await flush(); page.choices()[0].fire('click'); await flush();
  page.elements.previewRetry.fire('click'); await flush();
  await page.play(); assert.ok(page.video.src.includes(ids.D));
  assert.equal(page.choices().length, 0);
});

test('conflict refetches once and never automatically retries a choice at a new revision', async () => {
  const server = graphServer(); const page = browser({ server }); await flush();
  server.states.set('en', { node: 'C', revision: 4, positionMs: 500, status: 'active' });
  page.choices()[0].fire('click'); await flush();
  assert.equal(page.commands().length, 1);
  assert.match(page.elements.previewState.textContent, /another window/);
  await page.play(); assert.ok(page.video.src.includes(ids.C));
});

test('account switch fences late progress and removes private choices, tracks, and media', async () => {
  const pending = deferred(); const page = browser({ intercept: call => call.url.endsWith('/choices') ? pending.promise : undefined });
  await flush(); await page.play(); const old = page.video;
  page.choices()[0].fire('click'); await flush();
  page.data.set('lumina_auth', JSON.stringify({ accessToken: 'other-token', user: { id: 'other' } }));
  page.events.fire('storage', { key: 'lumina_auth' });
  pending.resolve(page.server.handle(page.commands()[0])); await flush();
  old.fire('loadedmetadata'); old.fire('error'); old.fire('timeupdate');
  assert.equal(page.elements.previewPlayer.hidden, true);
  assert.equal(page.choices().length, 0);
  assert.equal(page.video.src, '');
  assert.equal(page.video.querySelectorAll('track').length, 0);
});

test('locale switch fences old load, session, media events and leaves separate progress', async () => {
  const pending = deferred(); let held = false;
  const page = browser({ intercept: call => { if (call.url.endsWith('/playback-session') && !held) { held = true; return pending.promise; } } });
  await flush(); page.elements.previewStart.fire('click'); await flush();
  const oldSession = page.calls.at(-1);
  page.elements.previewLocale.value = 'ja'; page.elements.previewLocale.fire('change'); await flush();
  pending.resolve(page.server.handle(oldSession)); await flush();
  assert.equal(page.video.src, '');
  assert.match(page.choices()[0].textContent, /次のシーン/);
  await page.play(); const old = page.video;
  page.choices()[0].fire('click'); await flush(); await page.play();
  const count = page.calls.length;
  old.fire('error'); old.fire('loadedmetadata'); old.fire('pause'); old.fire('timeupdate');
  await flush(); assert.equal(page.calls.length, count); assert.ok(page.video.src.includes(ids.B));
});

test('readiness/revocation/session failures expose only localized errors without a substitute film', async () => {
  for (const result of [failure(409), failure(404), failure(410), failure(503)]) {
    const page = browser({ intercept: call => call.url.endsWith('/playback-session') ? result : undefined });
    await flush(); await page.play();
    assert.equal(page.video.src, '');
    assert.doesNotMatch(page.elements.previewState.textContent, /PRIVATE_DIAGNOSTIC|OTT_|[0-9a-f]{8}-/);
  }
  const server = graphServer(); server.manifest.readiness.previewReadyByLocale.en = false;
  const page = browser({ server }); await flush();
  assert.equal(page.calls.length, 1);
  assert.equal(page.elements.previewPlayer.hidden, true);
});

test('subtitle cues stay source-relative, confirmed only, and available tracks follow locale', async () => {
  const page = browser({ server: graphServer({ node: 'B' }) }); await flush();
  assert.equal(page.video.querySelectorAll('track').length, 1);
  assert.match(await [...page.blobs.values()][0].text(), /00:00:00\.300 --> 00:00:01\.400/);
  for (const locale of locales) {
    page.elements.previewLocale.value = locale; page.elements.previewLocale.fire('change'); await flush();
    assert.equal(page.video.querySelectorAll('track')[0].srclang, locale);
    assert.equal(page.document.documentElement.lang, locale);
  }
});

test('hidden/pagehide saves are best effort and preserve unknown command for later reconciliation', async () => {
  const pending = deferred(); const page = browser({ intercept: call => call.url.endsWith('/position') ? pending.promise : undefined });
  await flush(); await page.play(); page.video.currentTime = .5;
  page.events.fire('pagehide'); await flush();
  assert.equal(page.commands().length, 1);
  assert.equal(page.commands()[0].options.keepalive, true);
  assert.equal(page.commands()[0].options.signal.aborted, false);
  assert.equal(page.storage.size, 1);
  pending.resolve(page.server.handle(page.commands()[0])); await flush();
  assert.equal(page.video.src, '');
});

test('queued internal native pause cannot cancel resume while renewing its cookie session', async () => {
  const pending = deferred(); let sessions = 0;
  const page = browser({ intercept: call => { if (call.url.endsWith('/playback-session') && ++sessions === 2) return pending.promise; } });
  await flush(); await page.play();
  page.advanceTime(21000);
  page.video.paused = true;
  page.video.pause = function () { this.paused = true; };
  page.video.play(); await flush();
  page.video.fire('pause');
  const result = await page.server.handle(page.calls.at(-1)).json();
  result.playback.expiresAt = new Date(page.now() + 60000).toISOString();
  pending.resolve(ok(result)); await flush();
  assert.equal(page.video.paused, false);
  assert.equal(page.commands().length, 0);
});

test('source guards preserve legacy dispatch and prohibit public fallback, polls and client targets', () => {
  const script = readFileSync(new URL('../pages/ott-graph-preview.js', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('../pages/ott-private-preview.js', import.meta.url), 'utf8');
  assert.match(legacy, /entryParams\.has\("manifestId"\).*entryParams\.has\("previewId"\)/);
  assert.doesNotMatch(script, /targetNodeKey|\.innerHTML|localStorage\.setItem\([^,]+,\s*JSON\.stringify\(operation/);
  assert.match(script, /result\.idempotentReplay \? await readCurrent/);
  assert.match(script, /old\.replaceWith\(video\)/);
});

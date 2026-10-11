import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Parent copies this artifact into the admitted candidate's tests directory.
const rawSource = readFileSync(new URL('../pages/ott.js', import.meta.url));
const source = rawSource.toString('utf8').replace(/\r\n/g, '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourcePins = { raw: sha256(rawSource), lf: sha256(source) };
const apiBase = 'https://cinema.example.invalid';
const slug = 'synthetic-session-deadline';
const flush = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function section(from, to) {
  assert.equal(source.split(from).length - 1, 1, `unique actual-source start: ${from}`);
  assert.equal(source.split(to).length - 1, 1, `unique actual-source end: ${to}`);
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `ordered actual-source section: ${from}`);
  return source.slice(start, end);
}

const runtime = [
  section('  const apiPath =', '  function poster(item)'),
  section('  function clearPublicSessionTimer()', '  function showPublicChoices()'),
  section('  async function playPublicNode(', '  async function openPublicWatch('),
].join('\n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function observed(promise) {
  const result = { settled: false, error: null };
  result.done = Promise.resolve(promise).then(
    value => { result.settled = true; result.value = value; },
    error => { result.settled = true; result.error = error; },
  );
  return result;
}

function playbackFixture() {
  const node = key => ({ key, clip: { startMs: 0, endMs: 5000 }, subtitles: [],
    browserPlayback: { method: 'POST', sessionPath: `/api/v1/ott/${slug}/nodes/${key}/playback-session` } });
  return { slug, entryNodeKey: 'intro', nodes: new Map(['intro', 'branch'].map(key => [key, node(key)])),
    currentKey: null, loadedKey: null, loadedGeneration: null, expiresAt: 0, resumeAt: null };
}

function page(t) {
  let now = Date.parse('2026-10-11T00:00:00Z'), timerId = 0, bodyFailures = 0;
  const timers = new Map(), calls = [], metrics = { play: 0, pause: 0, load: 0, captions: 0, controls: 0 };
  const element = (hidden = true) => ({ hidden, focus() { this.focused = true; }, replaceChildren() {} });
  const choiceOverlay = element(), videoError = element(), playerControls = element(false);
  const errorChoices = element(), toggleCaptions = element(), retry = element();
  const publicChoices = element(), publicEnding = element(), demoChoices = element(false);
  const video = { src: '', paused: true, currentTime: 0, crossOrigin: null, playsInline: false,
    pause() { metrics.pause++; this.paused = true; },
    load() { metrics.load++; },
    play() { metrics.play++; this.paused = false; return Promise.resolve(); },
    removeAttribute(name) { assert.equal(name, 'src'); this.src = ''; } };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  function fetchSession(url, options) {
    const match = /^https:\/\/cinema\.example\.invalid\/api\/v1\/ott\/synthetic-session-deadline\/nodes\/(intro|branch)\/playback-session$/.exec(url);
    assert.ok(match, 'only the synthetic session route is admitted; no network fallback');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    const headers = deferred();
    let streamController, bodyClosed = false;
    const call = { key: match[1], signal: options.signal, headersSent: false,
      bodyReads: 0, aborts: 0, headerAborts: 0, bodyAborts: 0, jsonError: null };
    const stream = new ReadableStream({ start(controller) { streamController = controller; } });
    const response = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    const readJson = response.json.bind(response);
    response.json = async () => {
      call.bodyReads++;
      try { return await readJson(); }
      catch (error) { call.jsonError = error.name; bodyFailures++; throw error; }
    };
    function closeBody(error) {
      if (!bodyClosed) { bodyClosed = true; streamController.error(error); }
    }
    function onAbort() {
      call.aborts++;
      call.abortAt = now;
      const error = new DOMException('Synthetic session transport aborted', 'AbortError');
      if (!call.headersSent) { call.headerAborts++; headers.reject(error); }
      if (call.bodyReads) call.bodyAborts++;
      closeBody(error);
      options.signal.removeEventListener('abort', onAbort);
    }
    options.signal.addEventListener('abort', onAbort, { once: true });
    call.releaseHeaders = () => {
      assert.equal(call.headersSent, false);
      assert.equal(options.signal.aborted, false);
      call.headersSent = true;
      headers.resolve(response);
    };
    call.finishText = text => {
      assert.equal(bodyClosed, false);
      bodyClosed = true;
      streamController.enqueue(new TextEncoder().encode(text));
      streamController.close();
      options.signal.removeEventListener('abort', onAbort);
    };
    call.finishJson = data => call.finishText(JSON.stringify(data));
    call.failBody = () => {
      assert.equal(bodyClosed, false);
      closeBody(new Error('Synthetic body failure'));
      options.signal.removeEventListener('abort', onAbort);
    };
    call.dispose = () => {
      if (!call.headersSent) headers.reject(new Error('Synthetic fixture disposed'));
      closeBody(new Error('Synthetic fixture disposed'));
      options.signal.removeEventListener('abort', onAbort);
    };
    calls.push(call);
    return headers.promise;
  }

  const context = { API_BASE: apiBase, initialPlayback: playbackFixture(), Date: ClockDate, AbortController,
    choiceOverlay, videoError, playerControls, errorChoices, toggleCaptions,
    publicChoices, publicEnding, demoChoices, demoVideo: video,
    document: { getElementById(id) { assert.equal(id, 'ottVideoRetry'); return retry; } },
    clearCaptions() { metrics.captions++; toggleCaptions.hidden = true; },
    syncCaptionDisplay() {}, syncPlayerControls() { metrics.controls++; },
    fetch: fetchSession,
    setTimeout(callback, delay) {
      assert.equal(typeof callback, 'function');
      assert.ok(Number.isFinite(delay) && delay >= 0);
      const id = ++timerId;
      timers.set(id, { callback, delay, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const api = runInNewContext(`"use strict";
    let publicPlayback = initialPlayback;
    let publicGeneration = 0, publicWatchRequest = 0, publicSessionTimer = null, publicSeeking = false;
    ${runtime}
    ({ issuePublicSession, playPublicNode, renewPublicSession, stopPublicPlayback,
      state: () => ({ publicPlayback, publicGeneration, publicSessionTimer, publicSeeking }),
      installFixture: value => { if (publicPlayback !== null) throw new Error('fixture requires stopped player'); publicPlayback = value; }
    });`, context, { filename: 'pages/ott.js (actual session-body deadline functions)', timeout: 2000 });
  t.diagnostic(`sourceRawSha256=${sourcePins.raw} sourceLfSha256=${sourcePins.lf} extractedSha256=${sha256(runtime)}`);
  t.after(async () => {
    api.stopPublicPlayback();
    for (const call of calls) call.dispose();
    timers.clear();
    await flush();
    assert.equal(timers.size, 0, 'no synthetic fixture timer remains');
  });

  return { ...api, calls, metrics, video, videoError, playerControls, choiceOverlay, retry,
    now: () => now, bodyFailures: () => bodyFailures,
    timers: () => [...timers].map(([id, timer]) => ({ id, delay: timer.delay, due: timer.due })),
    advance(ms) {
      assert.ok(Number.isFinite(ms) && ms >= 0);
      const end = now + ms;
      let fired = 0;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++fired <= 16, 'finite synthetic timer budget');
        const [id, timer] = next;
        now = timer.due;
        timers.delete(id);
        timer.callback();
      }
      now = end;
    },
  };
}

function envelope(p, key = 'intro') {
  return { playback: { mode: 'secure_http_only_cookie',
    path: `/api/v1/ott/${slug}/nodes/${key}/delivery`, expiresAt: new Date(p.now() + 60000).toISOString() } };
}

function assertDeadline(p) {
  assert.equal(p.timers().filter(timer => timer.delay === 8000).length, 1,
    'actual helper retains exactly its original deadline while the request/body is pending');
}

function assertFailed(p) {
  assert.equal(p.videoError.hidden, false);
  assert.equal(p.playerControls.hidden, true);
  assert.equal(p.choiceOverlay.hidden, true);
  assert.equal(p.retry.focused, true);
  assert.equal(p.state().publicPlayback.loadedGeneration, null);
  assert.equal(p.timers().length, 0);
}

async function beginReady(p) {
  const work = observed(p.playPublicNode('intro'));
  const call = p.calls[0];
  call.releaseHeaders();
  call.finishJson(envelope(p));
  await flush();
  assert.equal(work.settled, true);
  assert.equal(work.error, null);
  return call;
}

test('initial body stall aborts at the original 8000ms deadline and exposes retry', { timeout: 2000 }, async t => {
  const p = page(t), start = p.now();
  const work = observed(p.playPublicNode('intro')), call = p.calls[0];
  call.releaseHeaders();
  await flush();
  assert.equal(call.bodyReads, 1);
  assertDeadline(p);
  p.advance(7999);
  await flush();
  assert.equal(work.settled, false);
  assert.equal(call.signal.aborted, false);
  p.advance(1);
  await flush();
  assert.equal(call.abortAt, start + 8000);
  assert.equal(call.signal.aborted, true);
  assert.equal(call.bodyAborts, 1);
  assert.equal(call.jsonError, 'AbortError');
  assert.equal(p.bodyFailures(), 1);
  assert.equal(work.settled, true);
  assert.equal(work.error, null, 'the real caller handles the body failure');
  assert.equal(p.metrics.play, 0);
  assert.equal(p.metrics.load, 0);
  assert.equal(p.video.src, '');
  assertFailed(p);
});

test('renewal body deadline preserves expiry handling and early body failure preserves retry', { timeout: 2000 }, async t => {
  for (const outcome of ['deadline-expired', 'early-failure-retry']) {
    const p = page(t);
    await beginReady(p);
    const generation = p.state().publicGeneration, expiry = p.state().publicPlayback.expiresAt;
    p.advance(55000);
    assert.equal(p.calls.length, 2, 'the real scheduled renewal issues one request');
    const call = p.calls[1];
    call.releaseHeaders();
    await flush();
    assertDeadline(p);
    assert.equal(call.bodyReads, 1);
    if (outcome === 'deadline-expired') {
      p.advance(8000);
      await flush();
      assert.equal(call.signal.aborted, true);
      assert.equal(call.bodyAborts, 1);
      assert.equal(call.jsonError, 'AbortError');
      assert.ok(p.now() >= expiry);
      assert.equal(p.state().publicGeneration, generation + 1);
      assertFailed(p);
    } else {
      p.advance(1000);
      call.failBody();
      await flush();
      assert.ok(p.now() < expiry);
      assert.equal(call.signal.aborted, false);
      assert.equal(p.videoError.hidden, true);
      assert.equal(p.state().publicGeneration, generation);
      assert.deepEqual(p.timers().map(timer => timer.delay), [3000]);
      p.advance(3000);
      assert.equal(p.calls.length, 3, 'the unchanged retry callback issues one request');
      p.calls[2].releaseHeaders();
      p.calls[2].finishJson(envelope(p));
      await flush();
      assert.deepEqual(p.timers().map(timer => timer.delay), [55000]);
    }
    assert.equal(p.metrics.load, 1, 'renewal does not reload media');
    assert.equal(p.metrics.play, 1, 'renewal does not implicitly replay');
  }
});

test('complete body retains safe delivery, credentials, generation and normal renewal', { timeout: 2000 }, async t => {
  const p = page(t), first = await beginReady(p);
  assert.equal(first.bodyReads, 1);
  assert.equal(first.signal.aborted, false);
  assert.equal(p.video.src, `${apiBase}/api/v1/ott/${slug}/nodes/intro/delivery`);
  assert.equal(p.video.crossOrigin, 'use-credentials');
  assert.equal(p.video.playsInline, true);
  assert.equal(p.playerControls.hidden, false);
  assert.equal(p.state().publicPlayback.loadedKey, 'intro');
  assert.equal(p.state().publicPlayback.loadedGeneration, p.state().publicGeneration);
  assert.equal(p.state().publicPlayback.resumeAt, 0);
  assert.deepEqual(p.timers().map(timer => timer.delay), [55000]);
  const generation = p.state().publicGeneration;
  p.advance(55000);
  p.calls[1].releaseHeaders();
  p.calls[1].finishJson(envelope(p));
  await flush();
  assert.equal(p.calls[1].signal.aborted, false);
  assert.equal(p.state().publicGeneration, generation);
  assert.deepEqual(p.timers().map(timer => timer.delay), [55000]);
  assert.equal(p.metrics.load, 1);
  assert.equal(p.metrics.play, 1);
  assert.equal(p.bodyFailures(), 0);
});

test('unresolved headers retain the original deadline without starting a body read', { timeout: 2000 }, async t => {
  const p = page(t), work = observed(p.playPublicNode('intro')), call = p.calls[0];
  assertDeadline(p);
  p.advance(7999);
  await flush();
  assert.equal(work.settled, false);
  assert.equal(call.signal.aborted, false);
  p.advance(1);
  await flush();
  assert.equal(call.signal.aborted, true);
  assert.equal(call.headerAborts, 1);
  assert.equal(call.bodyReads, 0);
  assert.equal(call.bodyAborts, 0);
  assert.equal(work.settled, true);
  assert.equal(p.metrics.load, 0);
  assert.equal(p.metrics.play, 0);
  assertFailed(p);
});

test('stopped or replaced loads ignore late body success and failure', { timeout: 2000 }, async t => {
  for (const outcome of ['stopped-success', 'replaced-success', 'replaced-failure']) {
    const p = page(t), old = observed(p.playPublicNode('intro')), oldCall = p.calls[0];
    oldCall.releaseHeaders();
    await flush();
    assert.equal(oldCall.bodyReads, 1);
    p.stopPublicPlayback();
    if (outcome !== 'stopped-success') {
      p.installFixture(playbackFixture());
      const current = observed(p.playPublicNode('branch'));
      p.calls[1].releaseHeaders();
      p.calls[1].finishJson(envelope(p, 'branch'));
      await flush();
      assert.equal(current.settled, true);
      assert.equal(current.error, null);
    }
    const generation = p.state().publicGeneration;
    const before = { ...p.metrics }, currentSrc = p.video.src;
    if (outcome === 'replaced-failure') oldCall.failBody();
    else oldCall.finishJson(envelope(p));
    await flush();
    assert.equal(old.settled, true);
    assert.equal(old.error, null);
    assert.equal(oldCall.signal.aborted, false, 'stop is not redefined as an abort policy');
    assert.equal(p.state().publicGeneration, generation);
    assert.deepEqual(p.metrics, before);
    assert.equal(p.video.src, currentSrc);
    assert.equal(p.videoError.hidden, true);
    if (outcome === 'stopped-success') {
      assert.equal(p.state().publicPlayback, null);
      assert.equal(p.video.src, '');
      assert.equal(p.timers().length, 0);
    } else {
      assert.equal(p.state().publicPlayback.loadedKey, 'branch');
      assert.equal(p.state().publicPlayback.loadedGeneration, generation);
      assert.deepEqual(p.timers().map(timer => timer.delay), [55000]);
    }
  }
});

test('malformed body, wrong delivery path and expired session retain the existing error path', { timeout: 2000 }, async t => {
  for (const outcome of ['malformed-json', 'wrong-path', 'expired']) {
    const p = page(t), work = observed(p.playPublicNode('intro')), call = p.calls[0];
    call.releaseHeaders();
    await flush();
    assertDeadline(p);
    if (outcome === 'malformed-json') call.finishText('{"playback":');
    else {
      const data = envelope(p);
      if (outcome === 'wrong-path') data.playback.path = `/api/v1/ott/${slug}/nodes/branch/delivery`;
      else data.playback.expiresAt = new Date(p.now() - 1).toISOString();
      call.finishJson(data);
    }
    await flush();
    assert.equal(work.settled, true);
    assert.equal(work.error, null);
    assert.equal(call.signal.aborted, false);
    assert.equal(call.bodyReads, 1);
    assert.equal(call.jsonError, outcome === 'malformed-json' ? 'SyntaxError' : null);
    assert.equal(p.bodyFailures(), outcome === 'malformed-json' ? 1 : 0);
    assert.equal(p.metrics.load, 0);
    assert.equal(p.metrics.play, 0);
    assertFailed(p);
    p.advance(8000);
    assert.equal(call.aborts, 0, 'an already failed body must not leave its deadline alive');
  }
});

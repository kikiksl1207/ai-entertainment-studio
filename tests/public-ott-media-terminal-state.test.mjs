import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/ott.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slug = 'synthetic-terminal';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const flush = () => new Promise(resolve => setImmediate(resolve));

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `actual runtime section: ${from}`);
  return source.slice(start, end);
}

// Actual media/session helpers and DOM listeners, without catalog/bootstrap requests.
const runtime = [
  section('  const copy =', '  function status('),
  section('  window.addEventListener("lumina:localechange"', '  load();\n})();'),
].join('\n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function watch(kind = 'terminal', language = 'en') {
  const node = key => ({
    key, clip: { startMs: 0, endMs: 5000 }, choices: [],
    subtitles: [{ startMs: 0, endMs: 5000, text: `${language} synthetic caption` }],
    ending: { label: 'Synthetic ending' },
    browserPlayback: { method: 'POST', sessionPath: `/api/v1/ott/${slug}/nodes/${key}/playback-session` },
  });
  const intro = node('intro');
  if (kind === 'choices') {
    intro.choices.push({ targetNodeKey: 'branch', label: 'Synthetic branch' });
    delete intro.ending;
  }
  return { entryNodeKey: 'intro', nodes: kind === 'choices' ? [intro, node('branch')] : [intro] };
}

function page({ language = 'en', deferSessions = false, rejectPlay = false } = {}) {
  const elements = new Map(), timers = new Map(), sessions = [], requests = [];
  const calls = { play: 0, pause: 0, load: 0, head: 0, subtitles: 0 };
  let currentLocale = language, timerId = 0, document;

  function element(tag = 'div', hidden = false) {
    const listeners = new Map(), classes = new Set();
    return {
      tag, hidden, disabled: false, dataset: {}, textContent: '', children: [],
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
      },
      addEventListener(type, callback) {
        const handlers = listeners.get(type) || [];
        handlers.push(callback);
        listeners.set(type, handlers);
      },
      fire(type, event = {}) { for (const callback of listeners.get(type) || []) callback(event); },
      click() { if (!this.disabled) this.fire('click'); },
      focus() { document.activeElement = this; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      scrollIntoView() {},
      getClientRects() { return this.hidden ? [] : [{}]; },
      contains(child) { return this.children.includes(child) || this.children.some(item => item.contains?.(child)); },
      querySelector(selector) {
        if (selector.startsWith('#')) return get(selector.slice(1));
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        if (selector === '[data-ott-branch]') return branches;
        if (selector.startsWith('[data-ott-branch="')) return branches.filter(b => selector.includes(`"${b.dataset.ottBranch}"`));
        if (selector === 'button') return this.children.filter(child => child.tag === 'button');
        if (selector === 'track[kind="subtitles"]') return [];
        return [];
      },
    };
  }

  const initiallyHidden = new Set([
    'ottDemo', 'ottChoiceOverlay', 'ottVideoError', 'ottPublicEnding', 'ottPublicChoices',
    'ottCaptionDisplay', 'ottToggleCaptions', 'ottFullscreenExit', 'ottErrorChoices',
  ]);
  const get = id => {
    if (!elements.has(id)) elements.set(id, element('div', initiallyHidden.has(id)));
    return elements.get(id);
  };
  const branches = ['embrace', 'ignore', 'hesitate'].map(key => {
    const button = element('button');
    button.dataset.ottBranch = key;
    button.disabled = key !== 'embrace';
    return button;
  });
  const posters = ['mother', 'joker'].map(key => {
    const button = element('button');
    button.dataset.ottDemo = key;
    return button;
  });
  get('ottChoiceOverlay').append(...branches, get('ottRestart'), get('ottChoiceBack'));
  const intro = element(), wrap = element(), window = element();
  document = Object.assign(element(), {
    body: element(), activeElement: null, fullscreenElement: null, hidden: false,
    getElementById: get,
    querySelector: selector => selector === '.ott-intro' ? intro : wrap,
    querySelectorAll: selector => selector === '[data-ott-demo]' ? posters : [],
    createElement: tag => element(tag),
  });
  const video = get('ottDemoVideo');
  Object.assign(video, {
    paused: true, ended: false, muted: false, currentTime: 0, duration: 5,
    pause() { calls.pause++; this.paused = true; },
    load() { calls.load++; this.ended = false; },
    play() {
      calls.play++;
      if (rejectPlay) return Promise.reject(new Error('synthetic play permission rejection'));
      this.paused = false;
      return Promise.resolve();
    },
  });
  window.LuminaI18n = { getLocale: () => currentLocale };
  const context = {
    document, window, navigator: { language, maxTouchPoints: 0 }, screen: {},
    localStorage: { getItem: () => null }, location: { search: `?title=${slug}` },
    API_BASE: '', URL, URLSearchParams, Blob, AbortController,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    apiFetch(path, options) {
      assert.equal(path, `/api/v1/ott/${slug}/watch?locale=${encodeURIComponent(currentLocale)}`);
      assert.equal(options.throwOnError, true);
      const pending = deferred();
      requests.push({ ...pending, path });
      return pending.promise;
    },
    fetch(path, options = {}) {
      if (options.method === 'POST') {
        assert.match(path, new RegExp(`^/api/v1/ott/${slug}/nodes/(intro|branch)/playback-session$`));
        assert.equal(options.credentials, 'include');
        assert.equal(options.cache, 'no-store');
        const pending = deferred();
        const key = path.split('/').at(-2);
        const response = { ok: true, json: async () => ({ playback: {
          mode: 'secure_http_only_cookie', path: `/api/v1/ott/${slug}/nodes/${key}/delivery`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        } }) };
        sessions.push({ ...pending, path, response });
        if (!deferSessions) pending.resolve(response);
        return pending.promise;
      }
      assert.match(path, /^\/assets\/ott\/(mothers-choice|joker-choice)\//);
      if (options.method === 'HEAD') {
        calls.head++;
        return Promise.resolve({ ok: true, headers: { get: key => key === 'content-type' ? 'video/mp4' : '100' } });
      }
      assert.match(path, /\.vtt$/);
      calls.subtitles++;
      return Promise.resolve({ ok: false });
    },
    load() { throw new Error('catalog bootstrap is outside this focused harness'); },
  };
  const api = runInNewContext(`${runtime}\n({
    openPublicWatch, playPublicNode, showPublicChoices, stopPublicPlayback,
    state: () => ({ publicPlayback, publicGeneration, publicSeeking })
  });`, context, { filename: 'pages/ott.js (synthetic media terminal state)', timeout: 2000 });
  const metrics = () => ({ ...calls, sessions: sessions.length, requests: requests.length, timers: timers.size });
  return {
    ...api, get, video, document, window, sessions, requests, timers, calls, metrics,
    async begin(kind = 'terminal') {
      const pending = api.openPublicWatch({ slug,
        title: { en: 'Synthetic title' }, synopsis: { en: 'Synthetic story' }, creatorName: { en: 'Synthetic creator' },
        viewing: { watchPath: `/api/v1/ott/${slug}/watch` },
      });
      requests.at(-1).resolve(watch(kind, currentLocale));
      await pending;
      await flush();
      if (!deferSessions) { video.fire('loadedmetadata'); video.currentTime = 4.9; }
    },
    async localeChange(nextLocale, kind = 'terminal') {
      currentLocale = nextLocale;
      window.fire('lumina:localechange');
      requests.at(-1).resolve(watch(kind, nextLocale));
      await flush();
    },
  };
}

function staysFailed(p, metrics) {
  assert.equal(p.get('ottVideoError').hidden, false, 'late media event cannot dismiss the error');
  assert.equal(p.get('ottChoiceOverlay').hidden, true, 'failed media cannot expose choices or an ending');
  assert.equal(p.get('ottPlayerControls').hidden, true);
  assert.equal(p.get('ottCaptionDisplay').hidden, true);
  assert.equal(p.document.activeElement, p.get('ottVideoRetry'), 'retry focus is retained');
  assert.equal(p.timers.size, 0, 'failed load cannot renew its session');
  assert.deepEqual(p.metrics(), metrics, 'implicit events make no request, reload, or playback attempt');
}

for (const kind of ['terminal', 'choices']) {
  for (const event of ['ended', 'timeupdate']) {
    test(`normal ${event} shows the ${kind} outcome without a new request`, async () => {
      const p = page();
      await p.begin(kind);
      p.video.fire('timeupdate');
      // Reopen a fresh loaded node so each event is independently exercised.
      await p.playPublicNode('intro');
      p.video.fire('loadedmetadata');
      p.video.currentTime = 4.9;
      const requests = p.sessions.length;
      p.video.fire(event);
      assert.equal(p.get('ottVideoError').hidden, true);
      assert.equal(p.get('ottChoiceOverlay').hidden, false);
      assert.equal(p.get('ottCaptionDisplay').hidden, true);
      assert.equal(p.get('ottPublicChoices').children.length, kind === 'choices' ? 1 : 0);
      assert.equal(p.get('ottPublicEnding').hidden, kind === 'choices');
      assert.equal(p.document.activeElement, kind === 'choices' ? p.get('ottPublicChoices').children[0] : p.get('ottRestart'));
      assert.equal(p.sessions.length, requests);
      assert.equal(p.timers.size, 0);
    });

    test(`failed ${kind} load stays terminal after late ${event}`, async () => {
      const p = page();
      await p.begin(kind);
      p.video.fire('error');
      const metrics = p.metrics();
      p.video.fire(event);
      staysFailed(p, metrics);
    });
  }

  test(`explicit retry alone releases a failed ${kind} load after current metadata`, async () => {
    const p = page({ deferSessions: true });
    await p.begin(kind);
    p.sessions[0].resolve(p.sessions[0].response);
    await flush();
    p.video.fire('loadedmetadata');
    p.video.currentTime = 4.9;
    p.video.fire('error');
    p.get('ottVideoRetry').click();
    assert.equal(p.sessions.length, 2, 'one explicit retry issues one session request');
    p.video.fire('loadedmetadata');
    p.video.fire('ended');
    p.video.fire('timeupdate');
    assert.equal(p.get('ottChoiceOverlay').hidden, true, 'old metadata/completion cannot finish a pending retry');
    assert.equal(p.state().publicSeeking, true);
    p.sessions[1].resolve(p.sessions[1].response);
    await flush();
    p.video.fire('ended');
    assert.equal(p.get('ottChoiceOverlay').hidden, true, 'new load still awaits its metadata');
    p.video.fire('loadedmetadata');
    assert.equal(p.state().publicSeeking, false);
    assert.equal(p.video.currentTime, 4.9, 'existing retry resume position is preserved');
    p.video.fire('ended');
    assert.equal(p.get('ottVideoError').hidden, true);
    assert.equal(p.get('ottChoiceOverlay').hidden, false);
    assert.equal(p.calls.play, 2);
    assert.equal(p.sessions.length, 2);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`a session settling with ${outcome} after media error cannot revive the failed load`, async () => {
    const p = page({ deferSessions: true });
    await p.begin();
    p.video.fire('error');
    const metrics = p.metrics();
    if (outcome === 'success') p.sessions[0].resolve(p.sessions[0].response);
    else p.sessions[0].reject(new Error('synthetic late session failure'));
    await flush();
    p.video.fire('loadedmetadata');
    p.video.fire('ended');
    p.video.fire('timeupdate');
    staysFailed(p, { ...metrics, timers: 0 });
    assert.equal(p.calls.play, 0);
    assert.equal(p.calls.load, 0);
  });

  test(`old load ${outcome} cannot replace or fail an explicitly requested newer load`, async () => {
    const p = page({ deferSessions: true });
    await p.begin('choices');
    const current = p.playPublicNode('branch');
    p.video.currentTime = 4.9;
    p.video.fire('loadedmetadata');
    p.video.fire('ended');
    p.video.fire('timeupdate');
    assert.equal(p.get('ottChoiceOverlay').hidden, true);
    assert.equal(p.state().publicSeeking, true);
    if (outcome === 'success') p.sessions[0].resolve(p.sessions[0].response);
    else p.sessions[0].reject(new Error('synthetic old load failure'));
    await flush();
    assert.equal(p.calls.play, 0);
    assert.equal(p.get('ottVideoError').hidden, true);
    p.sessions[1].resolve(p.sessions[1].response);
    await current;
    p.video.fire('loadedmetadata');
    assert.match(p.video.src, /\/nodes\/branch\/delivery$/);
    p.video.fire('ended');
    assert.equal(p.get('ottChoiceOverlay').hidden, false);
    assert.equal(p.get('ottPublicEnding').textContent, 'Synthetic ending');
    assert.equal(p.calls.play, 1);
  });
}

test('session failure remains closed until an explicit retry succeeds', async () => {
  const p = page({ deferSessions: true });
  await p.begin();
  p.sessions[0].resolve({ ok: false });
  await flush();
  const metrics = p.metrics();
  p.video.fire('ended');
  p.video.fire('timeupdate');
  staysFailed(p, metrics);
  p.get('ottVideoRetry').click();
  p.sessions[1].resolve(p.sessions[1].response);
  await flush();
  p.video.fire('loadedmetadata');
  p.video.fire('ended');
  assert.equal(p.get('ottChoiceOverlay').hidden, false);
  assert.equal(p.sessions.length, 2);
});

test('exiting a failed public load ignores late completion without opening demo choices', async () => {
  const p = page();
  await p.begin();
  p.video.fire('error');
  p.get('ottBackToList').click();
  await flush();
  const metrics = p.metrics();
  p.video.fire('ended');
  p.video.fire('timeupdate');
  assert.equal(p.state().publicPlayback, null);
  assert.equal(p.get('ottDemo').hidden, true);
  assert.equal(p.get('ottVideoError').hidden, true);
  assert.equal(p.get('ottChoiceOverlay').hidden, true);
  assert.equal(p.get('ottCaptionDisplay').hidden, true);
  assert.deepEqual(p.metrics(), metrics);
});

for (const outcome of ['success', 'failure']) {
  test(`exiting during a session drops its late ${outcome} and completion events`, async () => {
    const p = page({ deferSessions: true });
    await p.begin();
    p.get('ottBackToList').click();
    await flush();
    if (outcome === 'success') p.sessions[0].resolve(p.sessions[0].response);
    else p.sessions[0].reject(new Error('synthetic stopped session failure'));
    await flush();
    p.video.fire('loadedmetadata');
    p.video.fire('ended');
    p.video.currentTime = 4.9;
    p.video.fire('timeupdate');
    assert.equal(p.state().publicPlayback, null);
    assert.equal(p.get('ottChoiceOverlay').hidden, true);
    assert.equal(p.get('ottVideoError').hidden, true);
    assert.equal(p.timers.size, 0);
    assert.equal(p.calls.play, 0);
    assert.equal(p.sessions.length, 1);
  });
}

for (const language of locales) {
  test(`${language} locale refresh and caption toggles cannot clear the failed-load latch`, async () => {
    const p = page({ language });
    await p.begin('choices');
    p.video.currentTime = 1;
    p.video.fire('timeupdate');
    assert.equal(p.get('ottCaptionDisplay').textContent, `${language} synthetic caption`);
    assert.equal(p.get('ottCaptionDisplay').hidden, false);
    p.video.fire('error');
    await p.localeChange(language, 'choices');
    p.get('ottToggleCaptions').click();
    p.get('ottToggleCaptions').click();
    const metrics = p.metrics();
    p.video.fire('loadedmetadata');
    p.video.currentTime = 4.9;
    p.video.fire('ended');
    p.video.fire('timeupdate');
    staysFailed(p, metrics);
    assert.equal(p.sessions.length, 1, 'translation and captions do not implicitly retry');
  });
}

test('ordinary play rejection is not a media failure and retains manual play and valid completion', async () => {
  const p = page({ rejectPlay: true });
  await p.begin('choices');
  assert.equal(p.get('ottVideoError').hidden, true);
  assert.equal(p.get('ottPlayerControls').hidden, false);
  p.get('ottTogglePlayback').click();
  await flush();
  assert.equal(p.calls.play, 2);
  assert.equal(p.sessions.length, 1);
  assert.equal(p.get('ottVideoError').hidden, true);
  p.video.fire('ended');
  assert.equal(p.get('ottChoiceOverlay').hidden, false);
});

test('demo branch error still permits its explicit other-choice recovery', async () => {
  const p = page();
  await p.begin();
  p.get('ottBackToList').click();
  await flush();
  p.get('ottDemo').hidden = false;
  // Use the actual demo branch click, not a replacement demo/error implementation.
  p.get('ottChoiceOverlay').querySelector('[data-ott-branch="embrace"]').click();
  await flush();
  p.video.fire('error');
  assert.equal(p.get('ottErrorChoices').hidden, false);
  const sessions = p.sessions.length;
  p.get('ottErrorChoices').click();
  await flush();
  assert.equal(p.get('ottVideoError').hidden, true);
  assert.equal(p.get('ottChoiceOverlay').hidden, false);
  assert.equal(p.get('ottPublicEnding').hidden, true);
  assert.equal(p.sessions.length, sessions);
});

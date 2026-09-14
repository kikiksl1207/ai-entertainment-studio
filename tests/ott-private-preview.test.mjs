import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/ott-private-preview.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ott-private-preview/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/ott-private-preview.css', import.meta.url), 'utf8');
const fileId = '11111111-1111-4111-8111-111111111111';
const previewPath = `/api/v1/me/ott-media/files/${fileId}/preview`;
const sessionPath = `/api/v1/me/ott-media/files/${fileId}/playback-session`;
const deliveryPath = `/api/v1/ott-media/private-files/${fileId}/delivery`;

class Element {
  constructor(id = '') {
    this.id = id;
    this.listeners = new Map();
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.classList = { toggle() {} };
  }
  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ handler, once: options.once });
    this.listeners.set(type, listeners);
  }
  fire(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(listener => !listener.once));
    for (const listener of listeners) listener.handler(event);
  }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { this.parent.children = this.parent.children.filter(item => item !== this); }
  querySelectorAll(selector) { return selector === 'track' ? this.children.filter(child => child.kind === 'subtitles') : []; }
  getAttribute(name) { return this.attributes.get(name) || null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set src(value) { this.attributes.set('src', value); }
  get src() { return this.attributes.get('src') || ''; }
}

class Video extends Element {
  constructor() { super('privateVideo'); this.currentTime = 0; this.duration = 90; this.paused = true; this.loads = 0; }
  play() { this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.fire('pause'); } }
  load() { this.loads++; }
}

const preview = (subtitles = []) => ({ fileId, status: 'confirmed', visibility: 'private',
  media: { mimeType: 'video/mp4', durationMs: 90000 },
  browserPlayback: { sessionPath, method: 'POST', mode: 'secure_http_only_cookie' },
  subtitles, availableSubtitleLocales: subtitles.map(track => track.locale) });
const session = () => ({ playback: { path: deliveryPath, mode: 'secure_http_only_cookie',
  rangeSupported: true, expiresAt: new Date(Date.now() + 60000).toISOString() } });
const ok = data => ({ ok: true, status: 200, json: async () => data });
const fail = status => ({ ok: false, status });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function browser({ search = `?fileId=${fileId}`, signedIn = true, refreshToken = false,
  previewResponse = ok(preview()), sessionResponse = ok(session()), refreshResponse = fail(401), protocol = 'https:' } = {}) {
  const ids = ['previewLocale', 'localeLabel', 'studioLink', 'privateLabel', 'previewTitle',
    'previewState', 'previewPlayer', 'previewDuration', 'previewSubtitles', 'previewStart', 'previewRetry'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const video = new Video();
  elements.privateVideo = video;
  elements.previewPlayer.hidden = true;
  elements.previewRetry.hidden = true;
  const events = new Element();
  const document = { hidden: false, title: '', documentElement: { lang: '' },
    getElementById: id => elements[id] || null, createElement: () => new Element(),
    addEventListener: events.addEventListener.bind(events) };
  const data = new Map(signedIn ? [['lumina_auth', JSON.stringify({ accessToken: 'owner-token',
    ...(refreshToken ? { refreshToken: 'owner-refresh' } : {}), user: { id: 'owner-1' } })]] : []);
  const localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const calls = [];
  let onPreview = previewResponse;
  let onSession = sessionResponse;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith(previewPath)) return typeof onPreview === 'function' ? onPreview() : onPreview;
    if (url.endsWith(sessionPath)) return typeof onSession === 'function' ? onSession() : onSession;
    if (url.endsWith('/api/v1/auth/refresh')) return refreshResponse;
    throw new Error('Unexpected request');
  };
  const timers = new Map();
  let nextTimer = 0;
  const setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  const clearTimeout = id => timers.delete(id);
  const setInterval = callback => { events.interval = callback; return ++nextTimer; };
  const revoked = [];
  const blobs = new Map();
  const URL = { createObjectURL: blob => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; },
    revokeObjectURL: url => revoked.push(url) };
  const context = { window: { LUMINA_API_BASE: 'https://api.lumina-stage.com', addEventListener: events.addEventListener.bind(events) },
    document, location: { search, protocol }, localStorage, fetch, URL, Blob, URLSearchParams,
    AbortController, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval() {}, console };
  vm.runInNewContext(script, context, { filename: 'ott-private-preview.js' });
  return { elements, video, document, events, data, calls, timers, blobs, revoked,
    setPreview: value => { onPreview = value; }, setSession: value => { onSession = value; },
    postCalls: () => calls.filter(call => call.options.method === 'POST' && call.url.endsWith(sessionPath)),
    fireTimer: () => { const entry = [...timers.entries()].find(([, value]) => value.delay >= 10000 && value.delay < 30000);
      assert.ok(entry, 'refresh timer exists'); timers.delete(entry[0]); entry[1].callback(); } };
}

test('missing/invalid ID and signed-out states never request preview or session', async () => {
  for (const options of [{ search: '' }, { search: '?fileId=bad' }, { signedIn: false }, { protocol: 'http:' }]) {
    const page = browser(options);
    await flush();
    assert.equal(page.calls.length, 0);
    assert.equal(page.elements.previewPlayer.hidden, true);
  }
});

test('owner preview starts one credentialed session and seeks with a fresh session', async () => {
  const page = browser();
  await flush();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].options.credentials, 'include');
  assert.equal(page.postCalls().length, 0);
  assert.equal(page.elements.previewPlayer.hidden, false);
  page.elements.previewStart.fire('click');
  await flush();
  assert.equal(page.postCalls().length, 1);
  const request = page.postCalls()[0];
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.body, '{}');
  assert.equal(request.options.headers.Authorization, 'Bearer owner-token');
  assert.equal(page.video.src, `https://api.lumina-stage.com${deliveryPath}`);
  assert.doesNotMatch(page.video.src, /token|cookie|\?/);
  page.video.fire('loadedmetadata');
  await flush();
  assert.equal(page.video.paused, false);
  page.video.currentTime = 12;
  page.video.fire('seeking');
  await flush();
  assert.equal(page.postCalls().length, 2);
  page.video.fire('loadedmetadata');
  page.video.fire('seeked');
  await flush();
  assert.equal(page.video.currentTime, 12);
  assert.equal(page.video.paused, false);
  page.fireTimer();
  await flush();
  assert.equal(page.postCalls().length, 3);
});

test('only available JSON cues become local tracks, then account switch revokes them', async () => {
  const track = { locale: 'ko', status: 'available', format: 'json-cues',
    cues: [{ startMs: 0, endMs: 1200, text: '실제 자막 & 내용' }] };
  const page = browser({ previewResponse: ok(preview([track, { locale: 'en', status: 'pending', format: 'json-cues', cues: track.cues }])) });
  await flush();
  assert.equal(page.video.querySelectorAll('track').length, 1);
  const blob = [...page.blobs.values()][0];
  assert.match(await blob.text(), /실제 자막 &amp; 내용/);
  page.data.set('lumina_auth', JSON.stringify({ accessToken: 'other-token', user: { id: 'other' } }));
  page.events.fire('storage', { key: 'lumina_auth' });
  await flush();
  assert.equal(page.elements.previewPlayer.hidden, true);
  assert.equal(page.video.querySelectorAll('track').length, 0);
  assert.equal(page.revoked.length, 1);
  assert.equal(page.postCalls().length, 0);
});

test('a token swap with stale owner fields also stops playback', async () => {
  const page = browser();
  await flush();
  page.data.set('lumina_auth', JSON.stringify({ accessToken: 'new-account-token', user: { id: 'owner-1' } }));
  page.events.fire('storage', { key: 'lumina_auth' });
  assert.equal(page.elements.previewPlayer.hidden, true);
  assert.equal(page.postCalls().length, 0);
});

test('a 401 refresh keeps the same owner and retries preview with the new bearer', async () => {
  let reads = 0;
  const page = browser({ refreshToken: true,
    previewResponse: () => ++reads === 1 ? fail(401) : ok(preview()),
    refreshResponse: ok({ accessToken: 'renewed-token', refreshToken: 'renewed-refresh', user: { id: 'owner-1' } }) });
  await flush();
  assert.equal(reads, 2);
  assert.equal(page.elements.previewPlayer.hidden, false);
  assert.equal(page.calls.filter(call => call.url.endsWith('/api/v1/auth/refresh')).length, 1);
  assert.equal(page.calls.filter(call => call.url.endsWith(previewPath))[1].options.headers.Authorization, 'Bearer renewed-token');
  assert.equal(page.postCalls().length, 0);
});

test('no subtitles are invented; 401/403 and failed renewal stop without a loop', async () => {
  const empty = browser();
  await flush();
  assert.equal(empty.video.querySelectorAll('track').length, 0);
  assert.match(empty.elements.previewSubtitles.textContent, /사용 가능한 자막 없음/);
  for (const status of [401, 403]) {
    const denied = browser({ previewResponse: fail(status) });
    await flush();
    assert.equal(denied.elements.previewPlayer.hidden, true);
    assert.equal(denied.postCalls().length, 0);
  }
  const page = browser();
  await flush();
  page.elements.previewStart.fire('click');
  await flush();
  page.video.fire('loadedmetadata');
  await flush();
  page.setSession(fail(503));
  page.fireTimer();
  await flush();
  assert.equal(page.video.src, '');
  assert.equal(page.video.paused, true);
  assert.equal(page.postCalls().length, 2);
  assert.equal([...page.timers.values()].some(timer => timer.delay < 30000), false);
});

test('pausing during proactive renewal does not restart playback', async () => {
  const page = browser();
  await flush();
  page.elements.previewStart.fire('click');
  await flush();
  page.video.fire('loadedmetadata');
  await flush();
  let release;
  page.setSession(() => new Promise(resolve => { release = () => resolve(ok(session())); }));
  page.fireTimer();
  await flush();
  page.video.pause();
  release();
  await flush();
  assert.equal(page.video.paused, true);
  assert.equal(page.postCalls().length, 2);
  assert.equal([...page.timers.values()].some(timer => timer.delay >= 10000 && timer.delay < 30000), false);
});

test('native media failure refreshes once, then stops on a second failure', async () => {
  const page = browser();
  await flush();
  page.elements.previewStart.fire('click');
  await flush();
  page.video.fire('loadedmetadata');
  await flush();
  page.video.currentTime = 7;
  page.video.fire('timeupdate');
  page.video.fire('error');
  await flush();
  assert.equal(page.postCalls().length, 2);
  page.video.fire('loadedmetadata');
  page.video.fire('seeked');
  await flush();
  assert.equal(page.video.currentTime, 7);
  page.video.fire('error');
  await flush();
  assert.equal(page.video.src, '');
  assert.equal(page.video.paused, true);
  assert.equal(page.postCalls().length, 2);
});

test('owner denial on playback-session never exposes a source', async () => {
  const page = browser({ sessionResponse: fail(403) });
  await flush();
  page.elements.previewStart.fire('click');
  await flush();
  assert.equal(page.postCalls().length, 1);
  assert.equal(page.video.src, '');
  assert.equal(page.elements.previewPlayer.hidden, true);
});

test('hiding pauses and clears source; five locales and mobile widths are covered', async () => {
  const page = browser();
  await flush();
  page.elements.previewStart.fire('click');
  await flush();
  page.video.fire('loadedmetadata');
  await flush();
  page.video.currentTime = 8;
  page.document.hidden = true;
  page.events.fire('visibilitychange');
  assert.equal(page.video.src, '');
  assert.equal(page.video.paused, true);
  page.document.hidden = false;
  page.elements.previewStart.fire('click');
  await flush();
  assert.equal(page.postCalls().length, 2);
  page.video.fire('loadedmetadata');
  page.video.fire('seeked');
  await flush();
  assert.equal(page.video.currentTime, 8);
  page.elements.previewLocale.value = 'zh-Hant';
  page.elements.previewLocale.fire('change');
  assert.match(page.document.title, /私人影片預覽/);
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    assert.match(script, new RegExp(`(?:^|\\n)    ${locale.replace('-', '\\-') === 'ko' ? 'ko' : locale === 'en' || locale === 'ja' ? locale : '"' + locale + '"'}: \\{`));
  }
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /\.preview-player video \{[^}]*width: 100%/);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(html, /catalog|sample|fixture|mock/i);
});

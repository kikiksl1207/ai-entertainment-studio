'use strict';
// AUTHOR UNRUN. Whole selected consumer and actual selected HTML; synthetic boundaries only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/ott.js': '16de681ee2c2165aa566acb554591413e2bea1861cf3e5c68f3f6211ef24d708',
    'ott/index.html': 'cb819348717f4fd13b7253cd1aac1093450009da69340082548c805336f44f1f',
  }),
  current: Object.freeze({
    'pages/ott.js': 'b85518b394f535f4f7cb685c733407ee5e1be66ae0aaa813c6fa8b4d2f2bf20a',
    'ott/index.html': '0236d4bebbe4f213e5955357ddec25616a659c698e6f70e7aa55aa7496f1006c',
  }),
});
const phase = process.env.CINEMA_SUBTITLE_CAP_PHASE || 'current';
assert(Object.hasOwn(PINS, phase), 'Only the admitted source profiles are accepted');
const explicitRoot = process.env.CINEMA_SUBTITLE_CAP_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (explicitRoot) {
  const shared = ['E:/Codex/LuminaStage/ai-entertainment-studio-git',
    'E:/Codex/LuminaStage/story-completion-20261003'];
  assert(!shared.some(root => path.resolve(root).toLowerCase() === sourceRoot.toLowerCase()),
    'Explicit shared working source is not admitted');
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function source(file, rawPin) {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  assert(bytes.length > 0 && bytes.length <= 128 * 1024, 'Selected source size');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'), 'No source BOM');
  assert(Buffer.from(text).equals(bytes), 'Lossless UTF-8 source');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'), 'No bare CR');
  assert(text === lf || text === lf.replace(/\n/g, '\r\n'), 'Uniform LF or CRLF source');
  assert.equal(sha(lf), PINS[phase][file], 'Exact canonical LF source: ' + file);
  if (rawPin) assert.equal(sha(bytes), rawPin, 'Explicit selected raw pin');
  return lf;
}
const product = source('pages/ott.js', process.env.CINEMA_SUBTITLE_CAP_JS_SHA);
const html = source('ott/index.html', process.env.CINEMA_SUBTITLE_CAP_HTML_SHA);
const slug = 'synthetic-subtitles';
const route = key => '/api/v1/ott/' + slug + '/nodes/' + key;
const now = Date.parse('2026-10-16T00:00:00.000Z');
const options = { timeout: 10000, concurrency: false };
const flush = async () => { for (let index = 0; index < 64; index++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// This fixture models DOM/event plumbing, not seek rules or product state.
function createDOM() {
  let document;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  function matches(node, selector) {
    const attribute = /^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return (!attribute[1] || node.tag === attribute[1]) && node.attributes.has(attribute[2]) &&
      (attribute[3] === undefined || node.getAttribute(attribute[2]) === attribute[3]);
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    return node.tag === selector;
  }
  function element(tag) {
    const listeners = new Map(), classes = new Set();
    const node = {
      tag, tagName: tag.toUpperCase(), attributes: new Map(), dataset: {}, children: [], parentNode: null,
      hidden: false, disabled: false, value: '', min: '', max: '', step: '', id: '', _text: '',
      classList: { add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value) },
      setAttribute(name, value) {
        const string = String(value); this.attributes.set(name, string);
        if (name === 'hidden' || name === 'disabled') this[name] = true;
        else if (name === 'class') { classes.clear(); string.split(/\s+/).filter(Boolean).forEach(value => classes.add(value)); }
        else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = string;
        else this[name === 'playsinline' ? 'playsInline' : name] = string;
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      removeAttribute(name) { this.attributes.delete(name); if (name === 'hidden' || name === 'disabled') this[name] = false; else if (name === 'src') this.src = ''; },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
      fire(type, extra = {}) {
        const event = { target: this, currentTarget: this, preventDefault() {}, ...extra };
        for (const callback of [...(listeners.get(type) || [])]) callback(event);
      },
      click() { if (!this.disabled && this.isConnected) this.fire('click'); },
      focus() { document.activeElement = this; }, scrollIntoView() {},
      append(...nodes) { for (const child of nodes) { child.remove(); child.parentNode = this; this.children.push(child); } },
      replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); },
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } },
      contains(child) { return child === this || this.children.some(node => node.contains(child)); },
      getClientRects() { for (let node = this; node; node = node.parentNode) if (node.hidden) return []; return this.isConnected ? [{}] : []; },
      querySelectorAll(selector) {
        const result = [];
        const groups = selector.split(',').map(value => value.trim().split(/\s+/));
        const walk = node => { for (const child of node.children) {
          if (groups.some(parts => {
            if (!matches(child, parts.at(-1))) return false;
            let ancestor = child.parentNode;
            for (let index = parts.length - 2; index >= 0; index--) {
              while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parentNode;
              if (!ancestor) return false;
              ancestor = ancestor.parentNode;
            }
            return true;
          })) result.push(child);
          walk(child);
        } };
        walk(this); return result;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    Object.defineProperties(node, {
      isConnected: { get() { return !!document && document.contains(this); } },
      textContent: { get() { return this._text + this.children.map(child => child.textContent).join(''); },
        set(value) { this.replaceChildren(); this._text = String(value); } },
      innerHTML: { set(value) { this.replaceChildren(); parse(String(value), this); } },
      className: { get() { return [...classes].join(' '); }, set(value) { this.setAttribute('class', value); } },
    });
    return node;
  }
  function parse(markup, parent) {
    const stack = [parent];
    for (const token of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
      const tag = token[1].toLowerCase();
      if (token[0].startsWith('</')) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
        continue;
      }
      const node = element(tag);
      const attributes = token[0].slice(token[0].indexOf(token[1]) + token[1].length).replace(/\/?\s*>$/, '');
      for (const attr of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      stack.at(-1).append(node);
      if (!voidTags.has(tag) && !/\/\s*>$/.test(token[0])) stack.push(node);
    }
  }
  document = element('#document');
  document.activeElement = null; document.fullscreenElement = null; document.hidden = false;
  document.createElement = element;
  document.getElementById = id => document.querySelector('#' + id);
  parse(html, document);
  document.body = document.querySelector('body');
  assert(document.body);
  return { document, element };
}

function cues(count, language, key) {
  return Array.from({ length: count }, (_, index) => ({
    startMs: 5000 + index * 2, endMs: 5001 + index * 2,
    text: 'Synthetic ' + language + ' ' + key + ' cue ' + (index + 1),
  }));
}
function graph(count, language = 'en') {
  const node = (key, choices) => ({ key, clip: { startMs: 5000, endMs: 10000 },
    choices, subtitles: cues(count, language, key),
    ending: choices.length ? null : { label: 'Synthetic ending' },
    browserPlayback: { method: 'POST', sessionPath: route(key) + '/playback-session' } });
  return { entryNodeKey: 'intro', nodes: [
    node('intro', [{ targetNodeKey: 'branch', label: 'Synthetic next scene' }]),
    node('branch', []),
  ] };
}

function fixture(initialGraph) {
  const { document, element } = createDOM();
  const get = id => { const node = document.getElementById(id); assert(node, 'Actual selected HTML node: ' + id); return node; };
  const video = get('ottDemoVideo');
  const calls = [], sessions = [], watchQueue = [initialGraph], timers = new Map();
  const fixtureAdmissionFaults = [];
  const attempted = { api: 0, fetch: 0, storageReads: 0, storageWrites: 0, timers: 0 };
  let timerId = 0, language = 'en';
  function admit(run) {
    try { return run(); }
    catch (error) {
      fixtureAdmissionFaults.push('Synthetic boundary admission failed');
      throw error;
    }
  }
  const heads = new Set();
  for (const match of product.matchAll(/root:\s*"([^"]+)"[\s\S]*?clips:\s*\{([^}]+)\}/g)) {
    for (const clip of match[2].matchAll(/(\w+):\s*"([^"]+\.mp4)"/g)) heads.add(match[1] + clip[2]);
  }
  assert.equal(heads.size, 7, 'Published demo constants admitted without fetching bytes');
  const item = { slug, title: { en: 'Synthetic title', ja: 'Synthetic title JA' },
    synopsis: { en: 'Synthetic synopsis', ja: 'Synthetic synopsis JA' },
    creatorName: { en: 'Synthetic studio', ja: 'Synthetic studio JA' },
    posterPath: '', viewing: { available: true, watchPath: '/api/v1/ott/' + slug + '/watch' } };
  Object.assign(video, {
    paused: true, ended: false, muted: false, currentTime: 0, duration: NaN,
    src: '', textTracks: [], loads: 0, plays: 0, pauses: 0,
    pause() { this.pauses++; this.paused = true; this.fire('pause'); },
    load() { this.loads++; this.currentTime = 0; this.duration = NaN; this.ended = false; },
    play() { this.plays++; this.paused = false; this.fire('play'); return Promise.resolve(); },
  });
  Object.defineProperty(video, 'currentSrc', { get() { return this.src; } });
  const window = element('window');
  window.LuminaI18n = { getLocale: () => language };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const apiFetch = async (url, opts) => {
    attempted.api++;
    const selected = admit(() => {
      assert(attempted.api <= 8);
      assert.equal(opts?.throwOnError, true);
      assert.deepEqual(Object.keys(opts), ['throwOnError']);
      if (url === '/api/v1/ott/' + slug) {
        assert.equal(calls.filter(call => call.kind === 'detail').length, 0);
        calls.push({ kind: 'detail' }); return { promise: Promise.resolve(structuredClone(item)) };
      }
      assert.equal(url, '/api/v1/ott/' + slug + '/watch?locale=' + language);
      assert(watchQueue.length > 0, 'Every watch response is explicitly queued');
      calls.push({ kind: 'watch', language });
      const next = watchQueue.shift();
      return next && Object.hasOwn(next, 'promise') ? next : { promise: Promise.resolve(structuredClone(next)) };
    });
    // Intentional scripted response errors belong outside fixture admission.
    return await selected.promise;
  };
  const fetch = (url, opts = {}) => {
    attempted.fetch++;
    return admit(() => {
      assert(attempted.fetch <= 8);
      if (heads.has(url)) {
        assert.deepEqual(Object.keys(opts).sort(), ['cache', 'method']);
        assert.equal(opts.method, 'HEAD'); assert.equal(opts.cache, 'no-store');
        calls.push({ kind: 'head' });
        return Promise.resolve({ ok: true, headers: { get: name =>
          name === 'content-type' ? 'video/mp4' : name === 'content-length' ? '100' : null } });
      }
      const key = ['intro', 'branch'].find(value => url === route(value) + '/playback-session');
      assert(key, 'Only synthetic admitted playback-session paths');
      assert.deepEqual(Object.keys(opts).sort(), ['cache', 'credentials', 'method', 'signal']);
      assert.equal(opts.method, 'POST'); assert.equal(opts.credentials, 'include');
      assert.equal(opts.cache, 'no-store'); assert(opts.signal instanceof AbortSignal);
      calls.push({ kind: 'session', key });
      const pending = deferred();
      sessions.push({ key, pending, resolved: false, jsonReads: 0 });
      return pending.promise;
    });
  };
  const context = vm.createContext({ document, window,
    navigator: { language: 'en', maxTouchPoints: 0 }, screen: {},
    localStorage: {
      getItem() { attempted.storageReads++; return admit(() => { assert.fail('No storage read admitted'); }); },
      setItem() { attempted.storageWrites++; return admit(() => { assert.fail('No storage write admitted'); }); },
      removeItem() { attempted.storageWrites++; return admit(() => { assert.fail('No storage removal admitted'); }); },
    },
    location: { search: '?title=' + slug }, API_BASE: '', apiFetch, fetch,
    URL, URLSearchParams, Blob, AbortController, Date: Clock,
    setTimeout(callback, delay) {
      attempted.timers++;
      return admit(() => {
        assert.equal(typeof callback, 'function');
        assert(Number.isFinite(delay) && delay >= 0 && delay <= 60000 && timers.size < 8);
        const id = ++timerId; timers.set(id, { callback, delay }); return id;
      });
    },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  function check() {
    assert.deepEqual(fixtureAdmissionFaults, [], 'Fixture faults cannot be swallowed by product catches');
    assert.equal(attempted.storageReads, 0); assert.equal(attempted.storageWrites, 0);
    assert.equal(attempted.api, calls.filter(call => call.kind === 'detail' || call.kind === 'watch').length);
    assert.equal(attempted.fetch, calls.filter(call => call.kind === 'head' || call.kind === 'session').length);
  }
  const counts = () => Object.fromEntries(['detail', 'watch', 'head', 'session']
    .map(kind => [kind, calls.filter(call => call.kind === kind).length]));
  async function start() {
    await flush(); check();
    const button = get('ottStartViewing'); assert.equal(button.disabled, false);
    button.click(); await flush(); check();
  }
  async function resolveSession(index) {
    const session = sessions[index]; assert(session && !session.resolved); session.resolved = true;
    session.pending.resolve({ ok: true, json: async () => {
      session.jsonReads++;
      return { playback: { mode: 'secure_http_only_cookie', path: route(session.key) + '/delivery',
        expiresAt: new Date(now + 60000).toISOString() } };
    } });
    await flush(); check();
  }
  function metadata() { video.duration = 30; video.fire('loadedmetadata'); check(); }
  function atCue(index) { video.currentTime = (5000 + index * 2 + 0.5) / 1000; video.fire('timeupdate'); check(); }
  function caption(expected) {
    assert.equal(get('ottCaptionDisplay').textContent, expected);
    assert.equal(get('ottCaptionDisplay').hidden, false);
  }
  async function locale(value, response) {
    assert(['en', 'ja'].includes(value)); language = value;
    watchQueue.push(response); window.fire('lumina:localechange'); await flush(); check();
  }
  function finish() { check(); assert.equal(watchQueue.length, 0); timers.clear(); }
  return { document, get, video, sessions, timers, attempted, check, counts, start,
    resolveSession, metadata, atCue, caption, locale, enqueue: response => watchQueue.push(response), finish };
}

test('01 501 valid public cues reach the actual playback and caption consumer', options, async () => {
  const f = fixture(graph(501));
  try {
    await f.start();
    assert.equal(f.get('ottWatchStatus').textContent, '',
      'regression: a server-valid 501-cue graph must not become unavailable');
    assert.equal(f.sessions.length, 1,
      'regression: a server-valid 501-cue graph must reach playback-session');
    assert.equal(f.get('ottDemo').hidden, false);
    assert.deepEqual(f.counts(), { detail: 1, watch: 1, head: 3, session: 1 });
    await f.resolveSession(0); f.metadata(); f.atCue(500);
    f.caption('Synthetic en intro cue 501');
    assert.equal(f.video.src, route('intro') + '/delivery');
    assert.equal(f.video.plays, 1); f.check();
  } finally { f.finish(); }
});

test('02 exactly 2000 cues survive intact while overflow and malformed cues fail before session issuance', options, async () => {
  const accepted = fixture(graph(2000));
  try {
    await accepted.start(); assert.equal(accepted.sessions.length, 1);
    await accepted.resolveSession(0); accepted.metadata(); accepted.atCue(1999);
    accepted.caption('Synthetic en intro cue 2000');
    assert.deepEqual(accepted.counts(), { detail: 1, watch: 1, head: 3, session: 1 });
  } finally { accepted.finish(); }
  const invalid = [
    graph(2001),
    graph(2000),
    graph(2000),
  ];
  invalid[1].nodes[0].subtitles[1999].endMs = invalid[1].nodes[0].subtitles[1999].startMs;
  invalid[2].nodes[0].subtitles[1999].text = 'x'.repeat(2001);
  for (const payload of invalid) {
    const f = fixture(payload);
    try {
      await f.start();
      assert.equal(f.get('ottWatchStatus').textContent, 'The video could not be loaded.');
      assert.equal(f.get('ottStartViewing').disabled, false);
      assert.equal(f.get('ottDemo').hidden, true);
      assert.equal(f.sessions.length, 0); assert.equal(f.video.plays, 0);
      assert.equal(f.video.src, '');
      assert.deepEqual(f.counts(), { detail: 1, watch: 1, head: 3, session: 0 });
      assert.equal(f.attempted.fetch, 3, 'Denied graph must not even attempt a session or other fetch');
      await flush(); f.check();
      assert.equal(f.attempted.api, 2, 'No automatic watch retry');
      assert.equal(f.attempted.fetch, 3); assert.equal(f.timers.size, 0);
    } finally { f.finish(); }
  }
});

test('03 late large locale graphs and old-node sessions cannot replace a reopened current graph', options, async () => {
  const f = fixture(graph(501));
  const oldLocale = deferred();
  try {
    await f.start(); assert.equal(f.sessions.length, 1);
    await f.resolveSession(0); f.metadata();
    await f.locale('ja', oldLocale);
    await f.locale('en', graph(2000, 'en'));
    f.atCue(1999); f.caption('Synthetic en intro cue 2000');
    f.video.currentTime = 9.9; f.video.fire('timeupdate'); f.check();
    assert.equal(f.get('ottChoiceOverlay').hidden, false);
    const choice = f.get('ottPublicChoices').querySelector('button'); assert(choice);
    choice.click(); await flush(); f.check();
    assert.equal(f.sessions.length, 2); assert.equal(f.sessions[1].key, 'branch');
    f.get('ottBackToList').click(); await flush(); f.check();
    assert.equal(f.get('ottDemo').hidden, true);
    f.enqueue(graph(2000, 'en')); await f.start();
    assert.equal(f.sessions.length, 3); assert.equal(f.sessions[2].key, 'intro');
    await f.resolveSession(2); f.metadata(); f.atCue(1999);
    f.caption('Synthetic en intro cue 2000');
    const source = f.video.src, position = f.video.currentTime, before = f.counts();
    oldLocale.resolve(graph(2000, 'ja')); await flush(); f.check();
    await f.resolveSession(1);
    assert.equal(f.video.src, source); assert.equal(f.video.currentTime, position);
    f.caption('Synthetic en intro cue 2000');
    assert.equal(f.get('ottVideoError').hidden, true);
    assert.equal(f.get('ottChoiceOverlay').hidden, true);
    assert.equal(f.get('ottDemo').hidden, false);
    assert.equal(f.timers.size, 1, 'Only the current synthetic renewal timer remains');
    assert.deepEqual(before, { detail: 1, watch: 4, head: 3, session: 3 });
    assert.deepEqual(f.counts(), before); f.check();
  } finally { f.finish(); }
});

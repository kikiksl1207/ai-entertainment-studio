'use strict';
// Author UNRUN: evaluate the whole selected product script, never extracted functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/ott.js': '5ef35f36f76b1b9bcf88e5d577270fdf2b17af4fe48e2588b13f547491bbdec6',
    'ott/index.html': 'b6cef303ca0c1eed9b9b8488b0f8da6cc6a9565e9ce959ed661372151cc26d5c',
  }),
  focused: Object.freeze({
    'pages/ott.js': '237efc9aa1eec8894d0163a60523a50348e535957f47e65e90f66ff9287892d0',
    'ott/index.html': 'cf83b7696b20f88e2703597572a1c64aba1589f4a119b9bd0a3992ba38047cc1',
  }),
});
const phase = process.env.CINEMA_CLIP_SEEK_PHASE || 'focused';
assert(Object.hasOwn(PINS, phase));
const sourceRoot = path.resolve(process.env.CINEMA_CLIP_SEEK_SOURCE_ROOT || path.join(__dirname, '..'));
const shared = ['E:/Codex/LuminaStage/ai-entertainment-studio-git', 'E:/Codex/LuminaStage/story-completion-20261003'];
if (process.env.CINEMA_CLIP_SEEK_SOURCE_ROOT) assert(!shared.some(root => path.resolve(root).toLowerCase() === sourceRoot.toLowerCase()), 'shared product source is not admitted');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readSource(file, rawPin) {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'), 'unexpected source BOM');
  assert(Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'));
  if (text.includes('\r')) assert.equal(text, lf.replace(/\n/g, '\r\n'));
  assert.equal(sha(Buffer.from(lf)), PINS[phase][file], file);
  if (rawPin) assert.equal(sha(bytes), rawPin, 'explicit raw source pin');
  return lf;
}
const product = readSource('pages/ott.js', process.env.CINEMA_CLIP_SEEK_JS_SHA);
const html = readSource('ott/index.html', process.env.CINEMA_CLIP_SEEK_HTML_SHA);
const slug = 'synthetic-seek';
const route = key => `/api/v1/ott/${slug}/nodes/${key}`;
const now = Date.parse('2026-10-15T00:00:00.000Z');
const options = { timeout: 10000, concurrency: false };
const flush = async () => { for (let i = 0; i < 48; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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

function fixture() {
  const { document, element } = createDOM();
  const get = id => { const node = document.getElementById(id); assert(node, 'actual HTML node missing: ' + id); return node; };
  const video = get('ottDemoVideo'), seek = get('ottSeek');
  assert.equal(seek.tag, 'input'); assert.equal(seek.getAttribute('type'), 'range');
  assert.equal(seek.getAttribute('step'), '0.1');
  assert(document.querySelector('.ott-video-wrap').contains(video));
  const requests = [], sessions = [], timers = new Map(), problems = [];
  let timerId = 0, storageReads = 0, storageWrites = 0;
  const reject = () => { problems.push('unexpected synthetic boundary'); throw new Error('unexpected synthetic boundary'); };
  // Admit only the static product demo asset routes; never request their bytes.
  const heads = new Set(), captions = new Set();
  for (const match of product.matchAll(/root:\s*"([^"]+)"[\s\S]*?clips:\s*\{([^}]+)\}/g)) {
    for (const clip of match[2].matchAll(/(\w+):\s*"([^"]+\.mp4)"/g)) {
      heads.add(match[1] + clip[2]); captions.add(`${match[1]}subtitles/${clip[1]}.en.vtt`);
    }
  }
  assert.equal(heads.size, 7, 'bounded published demo constants');
  const node = (key, startMs, endMs, choices = []) => ({ key, clip: { startMs, endMs }, choices, subtitles: [],
    ending: choices.length ? null : { label: 'Synthetic ending' },
    browserPlayback: { method: 'POST', sessionPath: route(key) + '/playback-session' } });
  const graph = { entryNodeKey: 'intro', nodes: [
    node('intro', 5000, 10000, [{ targetNodeKey: 'branch', label: 'Synthetic branch' }]),
    node('branch', 15000, 20000),
  ] };
  const item = { slug, title: { en: 'Synthetic title' }, synopsis: { en: 'Synthetic synopsis' },
    creatorName: { en: 'Synthetic studio' }, posterPath: '',
    viewing: { available: true, watchPath: `/api/v1/ott/${slug}/watch` } };
  Object.assign(video, { paused: true, ended: false, muted: false, currentTime: 0, duration: NaN,
    src: '', textTracks: [], loads: 0, plays: 0, pauses: 0,
    pause() { this.pauses++; this.paused = true; this.fire('pause'); },
    load() { this.loads++; this.currentTime = 0; this.duration = NaN; this.ended = false; },
    play() { this.plays++; this.paused = false; this.fire('play'); return Promise.resolve(); },
  });
  Object.defineProperty(video, 'currentSrc', { get() { return this.src; } });
  const window = element('window');
  window.LuminaI18n = { getLocale: () => 'en' };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const apiFetch = async (url, opts) => {
    if (opts?.throwOnError !== true || Object.keys(opts).length !== 1 || requests.length >= 32) return reject();
    if (url === `/api/v1/ott/${slug}`) { requests.push({ kind: 'detail' }); return structuredClone(item); }
    if (url === `/api/v1/ott/${slug}/watch?locale=en`) { requests.push({ kind: 'watch' }); return structuredClone(graph); }
    return reject();
  };
  const fetch = (url, opts = {}) => {
    if (requests.length >= 32) return reject();
    if (heads.has(url) && opts.method === 'HEAD' && opts.cache === 'no-store' && Object.keys(opts).length === 2) {
      requests.push({ kind: 'head' });
      return Promise.resolve({ ok: true, headers: { get: name => name === 'content-type' ? 'video/mp4' : name === 'content-length' ? '100' : null } });
    }
    if (captions.has(url) && Object.keys(opts).length === 0) {
      requests.push({ kind: 'caption' }); return Promise.resolve({ ok: false });
    }
    const key = ['intro', 'branch'].find(key => url === route(key) + '/playback-session');
    if (key && opts.method === 'POST' && opts.credentials === 'include' && opts.cache === 'no-store' &&
      opts.signal instanceof AbortSignal && Object.keys(opts).sort().join(',') === 'cache,credentials,method,signal') {
      requests.push({ kind: 'session', key });
      const pending = deferred(); sessions.push({ key, pending, resolved: false }); return pending.promise;
    }
    return reject();
  };
  const context = vm.createContext({ document, window, navigator: { language: 'en', maxTouchPoints: 0 }, screen: {},
    localStorage: { getItem() { storageReads++; return null; }, setItem() { storageWrites++; return reject(); }, removeItem() { storageWrites++; return reject(); } },
    location: { search: `?title=${slug}` }, API_BASE: '', apiFetch, fetch,
    URL, URLSearchParams, Blob, AbortController, Date: Clock,
    setTimeout(callback, delay) { assert(Number.isFinite(delay) && delay >= 0 && timers.size < 8); const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  const healthy = () => { assert.equal(problems.length, 0); assert.equal(storageWrites, 0); assert.equal(storageReads, 0); };
  const counts = () => Object.fromEntries(['detail', 'watch', 'head', 'caption', 'session'].map(kind => [kind, requests.filter(request => request.kind === kind).length]));
  const metadata = (duration = 30) => { video.duration = duration; video.fire('loadedmetadata'); healthy(); };
  const input = value => { seek.value = String(value); seek.fire('input'); healthy(); };
  const resolveSession = async index => {
    const session = sessions[index]; assert(session && !session.resolved); session.resolved = true;
    session.pending.resolve({ ok: true, json: async () => ({ playback: { mode: 'secure_http_only_cookie',
      path: route(session.key) + '/delivery', expiresAt: new Date(now + 60000).toISOString() } }) });
    await flush(); healthy();
  };
  const start = async () => {
    await flush(); healthy();
    get('ottStartViewing').click(); await flush(); healthy();
  };
  const ready = async () => { await start(); assert.equal(sessions.length, 1); await resolveSession(0); metadata(); assert.equal(video.currentTime, 5); };
  const noExtra = before => { assert.deepEqual(counts(), before); healthy(); };
  return { document, get, video, seek, sessions, timers, counts, metadata, input, resolveSession, start, ready, noExtra, healthy };
}

test('01 public below-start input cannot move before the accepted clip', options, async () => {
  const f = fixture(); await f.ready();
  const before = f.counts();
  assert.deepEqual(before, { detail: 1, watch: 1, head: 3, caption: 0, session: 1 });
  f.input(2);
  assert.equal(f.video.currentTime, 5, 'regression: seek below nonzero public clip start');
  assert.equal(Number(f.seek.value), 5);
  f.noExtra(before);
});

test('02 public bounds follow metadata and preserve an in-clip position', options, async () => {
  const f = fixture(); await f.ready(); const before = f.counts();
  assert.equal(f.seek.disabled, false); assert.equal(Number(f.seek.min), 5); assert.equal(Number(f.seek.max), 10);
  assert.equal(Number(f.seek.value), 5); assert.equal(f.get('ottTime').textContent, '0:05 / 0:10');
  f.input(6); assert.equal(f.video.currentTime, 6); assert.equal(Number(f.seek.value), 6);
  f.video.duration = 8; f.video.fire('durationchange');
  assert.equal(Number(f.seek.min), 5); assert.equal(Number(f.seek.max), 8);
  f.input(9); assert.equal(f.video.currentTime, 8); assert.equal(Number(f.seek.value), 8);
  assert.equal(f.get('ottChoiceOverlay').hidden, true); f.noExtra(before);
});

test('03 forged range attributes, above-end and nonfinite inputs do not escape the clip', options, async () => {
  const f = fixture(); await f.ready(); const before = f.counts();
  f.seek.min = '-100'; f.seek.max = '1000'; f.input(25);
  assert.equal(f.video.currentTime, 10); assert.equal(Number(f.seek.min), 5); assert.equal(Number(f.seek.max), 10);
  f.input(-20); assert.equal(f.video.currentTime, 5);
  f.input(7); assert.equal(f.video.currentTime, 7);
  // Deliberately bypass native range-value sanitation to exercise the listener's guard.
  for (const value of ['NaN', 'Infinity', '-Infinity', 'synthetic-invalid']) {
    f.input(value); assert.equal(f.video.currentTime, 7); assert(Number.isFinite(f.video.currentTime));
  }
  f.seek.disabled = true; f.input(9); assert.equal(f.video.currentTime, 7);
  f.noExtra(before);
});

test('04 demo seek keeps the full duration through an actual branch transition', options, async () => {
  const f = fixture(); await flush(); f.healthy();
  f.get('ottOpenDemo').click(); await flush(); f.metadata();
  assert.equal(f.seek.disabled, false); assert.equal(Number(f.seek.min), 0); assert.equal(Number(f.seek.max), 30);
  const firstSource = f.video.src; assert(firstSource);
  f.input(2); assert.equal(f.video.currentTime, 2);
  f.input(24); assert.equal(f.video.currentTime, 24);
  f.video.ended = true; f.video.fire('ended'); await flush();
  assert.equal(f.get('ottChoiceOverlay').hidden, false);
  const choice = f.document.querySelector('[data-ott-branch="embrace"]'); assert.equal(choice.disabled, false);
  choice.click(); await flush(); f.metadata();
  assert.notEqual(f.video.src, firstSource); assert.equal(f.get('ottChoiceOverlay').hidden, true);
  assert.equal(Number(f.seek.min), 0); assert.equal(Number(f.seek.max), 30);
  f.input(2); assert.equal(f.video.currentTime, 2);
  assert.deepEqual(f.counts(), { detail: 1, watch: 0, head: 9, caption: 2, session: 0 }); f.healthy();
});

test('05 choices, pending current-node metadata and errors keep public seek inactive', options, async () => {
  const f = fixture(); await f.ready();
  f.video.currentTime = 9.9; f.video.fire('timeupdate');
  assert.equal(f.get('ottChoiceOverlay').hidden, false); assert.equal(f.seek.disabled, true);
  let before = f.counts(); f.seek.disabled = false; f.input(2); assert.equal(f.video.currentTime, 9.9); f.noExtra(before);
  f.get('ottPublicChoices').querySelector('button').click(); await flush();
  assert.equal(f.sessions.length, 2); assert.equal(f.sessions[1].key, 'branch');
  f.video.duration = 30; f.video.fire('durationchange'); assert.equal(f.seek.disabled, true);
  before = f.counts(); f.seek.disabled = false; f.input(6); assert.equal(f.video.currentTime, 9.9); f.noExtra(before);
  await f.resolveSession(1);
  assert.equal(f.seek.disabled, true);
  f.video.duration = 30; f.video.fire('durationchange');
  before = f.counts(); f.seek.disabled = false; f.input(17); assert.equal(f.video.currentTime, 0); f.noExtra(before);
  f.metadata(); assert.equal(f.video.currentTime, 15);
  assert.equal(f.seek.disabled, false); assert.equal(Number(f.seek.min), 15); assert.equal(Number(f.seek.max), 20);
  f.input(18); assert.equal(f.video.currentTime, 18);
  f.video.fire('error'); assert.equal(f.get('ottVideoError').hidden, false); assert.equal(f.seek.disabled, true);
  before = f.counts(); f.seek.disabled = false; f.input(19); assert.equal(f.video.currentTime, 18); f.noExtra(before);
  assert.deepEqual(f.counts(), { detail: 1, watch: 1, head: 3, caption: 0, session: 2 });
});

test('06 a late previous-node session cannot replace a reopened current public clip', options, async () => {
  const f = fixture(); await f.ready();
  f.video.currentTime = 9.9; f.video.fire('timeupdate');
  f.get('ottPublicChoices').querySelector('button').click(); await flush();
  assert.equal(f.sessions[1].key, 'branch');
  f.get('ottBackToList').click(); await flush(); assert.equal(f.get('ottDemo').hidden, true);
  await f.start(); assert.equal(f.sessions.length, 3); assert.equal(f.sessions[2].key, 'intro');
  await f.resolveSession(2); f.metadata();
  const currentSource = f.video.src; const before = f.counts();
  await f.resolveSession(1);
  assert.equal(f.video.src, currentSource); assert.equal(f.video.currentTime, 5);
  assert.equal(f.seek.disabled, false); assert.equal(Number(f.seek.min), 5); assert.equal(Number(f.seek.max), 10);
  assert.equal(f.timers.size, 1, 'only the current synthetic session renewal timer remains');
  f.input(7); assert.equal(f.video.currentTime, 7);
  assert.deepEqual(before, { detail: 1, watch: 2, head: 3, caption: 0, session: 3 }); f.noExtra(before);
});

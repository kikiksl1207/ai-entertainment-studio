'use strict';
// AUTHOR UNRUN. Whole selected consumer/HTML; no exported product closures or old test imports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/ott.js': Object.freeze({ sha256: '861c6a312b5aba3d8c1f6103b5adeb2cc5ce1dafb76c9c6b37d66ba0918ea0f0', gitBlob: '73a39114f9b1c443376284a92b55ac7a1e5607bd' }),
    'ott/index.html': Object.freeze({ sha256: 'da223280df839e703dc4e0ecd56fb0e511599e9a52b13504f8c6246e08c89f68', gitBlob: '7424232db5e453ba39e990c8b071548939aa6438' }),
  }),
  current: Object.freeze({
    'pages/ott.js': Object.freeze({ sha256: 'b85518b394f535f4f7cb685c733407ee5e1be66ae0aaa813c6fa8b4d2f2bf20a', gitBlob: '1dad5ceb210afd180cb884c2fbe7b02c53120557' }),
    'ott/index.html': Object.freeze({ sha256: '0236d4bebbe4f213e5955357ddec25616a659c698e6f70e7aa55aa7496f1006c', gitBlob: '65267e089cb985ecaa3eb212f504bae1d82c2ad7' }),
  }),
});
const phase = process.env.CINEMA_INITIAL_LOCALE_PHASE || 'current';
assert(Object.prototype.hasOwnProperty.call(PINS, phase), 'Only frozen source profiles');
const explicitRoot = process.env.CINEMA_INITIAL_LOCALE_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (explicitRoot) {
  for (const root of ['E:/Codex/LuminaStage/ai-entertainment-studio-git',
    'E:/Codex/LuminaStage/story-completion-20261003']) {
    assert.notEqual(sourceRoot.toLowerCase(), path.resolve(root).toLowerCase(), 'No explicit shared working source');
  }
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function source(file, rawPin) {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  assert(bytes.length > 0 && bytes.length <= 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes), 'Lossless non-BOM UTF-8');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'));
  assert(text === lf || text === lf.replace(/\n/g, '\r\n'), 'Only uniform LF/CRLF');
  assert.equal(sha(lf), PINS[phase][file].sha256);
  assert.equal(blob(Buffer.from(lf)), PINS[phase][file].gitBlob, 'Same canonical source variant');
  if (rawPin) assert.equal(sha(bytes), rawPin, 'Explicit capsule bytes');
  return lf;
}
const product = source('pages/ott.js', process.env.CINEMA_INITIAL_LOCALE_JS_SHA);
const html = source('ott/index.html', process.env.CINEMA_INITIAL_LOCALE_HTML_SHA);
const slug = 'synthetic-initial-locale';
const route = '/api/v1/ott/' + slug;
const now = Date.parse('2026-10-16T00:00:00.000Z');
const options = { timeout: 10000, concurrency: false };
const flush = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Only DOM/event plumbing is copied from Unit33; none of its registrations execute.
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

function graph(language) {
  return { entryNodeKey: 'intro', nodes: [{
    key: 'intro', clip: { startMs: 5000, endMs: 10000 }, choices: [],
    subtitles: [{ startMs: 5000, endMs: 9000, text: 'Synthetic ' + language + ' current caption' }],
    ending: { label: 'Synthetic ' + language + ' ending' },
    browserPlayback: { method: 'POST', sessionPath: route + '/nodes/intro/playback-session' },
  }] };
}
function fixture() {
  const { document, element } = createDOM();
  const get = id => { const node = document.getElementById(id); assert(node, 'Actual HTML node: ' + id); return node; };
  const video = get('ottDemoVideo'), window = element('window');
  let language = 'en', timerId = 0;
  const faults = [], calls = [], scripts = [], sessions = [], timers = new Map();
  const attempts = { api: 0, fetch: 0, storageRead: 0, storageWrite: 0, timer: 0, timerClear: 0, sessionBody: 0 };
  const item = { slug, title: { en: 'Synthetic EN title', ja: 'Synthetic JA title' },
    synopsis: { en: 'Synthetic EN synopsis', ja: 'Synthetic JA synopsis' },
    creatorName: { en: 'Synthetic EN studio', ja: 'Synthetic JA studio' }, posterPath: '',
    viewing: { available: true, watchPath: route + '/watch' } };
  function admit(run) {
    try { return run(); } catch (error) { faults.push('Synthetic boundary admission failed'); throw error; }
  }
  const heads = new Set();
  for (const match of product.matchAll(/root:\s*"([^"]+)"[\s\S]*?clips:\s*\{([^}]+)\}/g)) {
    for (const clip of match[2].matchAll(/(\w+):\s*"([^"]+\.mp4)"/g)) heads.add(match[1] + clip[2]);
  }
  assert.equal(heads.size, 7);
  Object.assign(video, {
    paused: true, ended: false, muted: false, currentTime: 0, duration: NaN,
    src: '', textTracks: [], loads: 0, plays: 0, pauses: 0,
    pause() { this.pauses++; this.paused = true; this.fire('pause'); },
    load() { this.loads++; this.currentTime = 0; this.duration = NaN; this.ended = false; },
    play() { this.plays++; this.paused = false; this.fire('play'); return Promise.resolve(); },
  });
  Object.defineProperty(video, 'currentSrc', { get() { return this.src; } });
  window.LuminaI18n = { getLocale: () => language };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function expect(kind, selectedLanguage, value) {
    assert(['detail', 'watch'].includes(kind)); assert(['en', 'ja'].includes(selectedLanguage));
    scripts.push({ kind, language: selectedLanguage, value });
  }
  expect('detail', 'en', item);
  const apiFetch = async (url, opts) => {
    attempts.api++;
    const next = admit(() => {
      assert(attempts.api <= 10);
      assert.deepEqual(Object.keys(opts || {}), ['throwOnError']); assert.equal(opts.throwOnError, true);
      assert(scripts.length > 0, 'Every API invocation is explicitly planned');
      const plan = scripts.shift();
      assert.equal(plan.language, language, 'Current synthetic i18n at actual dispatch');
      assert.equal(url, plan.kind === 'detail' ? route : route + '/watch?locale=' + plan.language);
      calls.push({ kind: plan.kind, language: plan.language });
      return plan.value;
    });
    // Deliberate response rejection is not an admission fault and is awaited by actual product code.
    return next && Object.prototype.hasOwnProperty.call(next, 'promise')
      ? await next.promise : structuredClone(next);
  };
  const fetch = (url, opts = {}) => {
    attempts.fetch++;
    return admit(() => {
      assert(attempts.fetch <= 5);
      if (heads.has(url)) {
        assert.deepEqual(Object.keys(opts).sort(), ['cache', 'method']);
        assert.equal(opts.method, 'HEAD'); assert.equal(opts.cache, 'no-store');
        calls.push({ kind: 'head' });
        return Promise.resolve({ ok: true, headers: { get: name =>
          name === 'content-type' ? 'video/mp4' : name === 'content-length' ? '100' : null } });
      }
      assert.equal(url, route + '/nodes/intro/playback-session', 'Only synthetic session invocation');
      assert.deepEqual(Object.keys(opts).sort(), ['cache', 'credentials', 'method', 'signal']);
      assert.equal(opts.method, 'POST'); assert.equal(opts.credentials, 'include');
      assert.equal(opts.cache, 'no-store'); assert(opts.signal instanceof AbortSignal);
      assert.equal(sessions.length, 0, 'No session retry or stale second session admitted');
      const pending = deferred();
      sessions.push({ pending, resolved: false, bodyRead: false });
      calls.push({ kind: 'session' });
      return pending.promise;
    });
  };
  const context = vm.createContext({ document, window, navigator: { language: 'en', maxTouchPoints: 0 }, screen: {},
    location: { search: '?title=' + slug }, API_BASE: '', apiFetch, fetch,
    localStorage: {
      getItem() { attempts.storageRead++; return admit(() => assert.fail('No storage read')); },
      setItem() { attempts.storageWrite++; return admit(() => assert.fail('No storage write')); },
      removeItem() { attempts.storageWrite++; return admit(() => assert.fail('No storage removal')); },
    },
    URL, URLSearchParams, Blob, AbortController, Date: Clock,
    setTimeout(callback, delay) {
      attempts.timer++;
      return admit(() => {
        assert.equal(typeof callback, 'function');
        assert(Number.isFinite(delay) && delay >= 0 && delay <= 60000 && timers.size < 4);
        const id = ++timerId; timers.set(id, { callback, delay }); return id;
      });
    },
    clearTimeout(id) {
      attempts.timerClear++;
      return admit(() => { assert(Number.isSafeInteger(id) && timers.has(id)); timers.delete(id); });
    },
  });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  function check() {
    assert.deepEqual(faults, [], 'Fixture admission failures cannot become product success');
    assert.equal(attempts.storageRead, 0); assert.equal(attempts.storageWrite, 0);
    assert.equal(attempts.api, calls.filter(call => call.kind === 'detail' || call.kind === 'watch').length);
    assert.equal(attempts.fetch, calls.filter(call => call.kind === 'head' || call.kind === 'session').length);
    assert.equal(attempts.sessionBody, sessions.filter(session => session.bodyRead).length);
  }
  const counts = () => Object.fromEntries(['detail', 'watch', 'head', 'session']
    .map(kind => [kind, calls.filter(call => call.kind === kind).length]));
  async function ready() {
    await flush(); check(); assert.equal(scripts.length, 0);
    const button = get('ottStartViewing');
    assert(button.isConnected); assert.equal(button.disabled, false);
    assert.deepEqual(counts(), { detail: 1, watch: 0, head: 3, session: 0 });
    return button;
  }
  async function start(response) {
    await flush(); check();
    const button = get('ottStartViewing'); assert(button.isConnected); assert.equal(button.disabled, false);
    expect('watch', language, response); button.click(); await flush(); check();
    assert.equal(scripts.length, 0); return button;
  }
  async function locale(value) {
    assert(['en', 'ja'].includes(value)); assert.notEqual(value, language);
    language = value; expect('detail', value, item);
    window.fire('lumina:localechange'); await flush(); check();
    assert.equal(scripts.length, 0);
    const button = get('ottStartViewing'); assert(button.isConnected); assert.equal(button.disabled, false);
    return button;
  }
  async function resolveSession() {
    assert.equal(sessions.length, 1);
    const session = sessions[0]; assert.equal(session.resolved, false); session.resolved = true;
    session.pending.resolve({ ok: true, json: async () => {
      attempts.sessionBody++;
      return admit(() => {
        assert.equal(session.bodyRead, false); session.bodyRead = true;
        return { playback: { mode: 'secure_http_only_cookie', path: route + '/nodes/intro/delivery',
          expiresAt: new Date(now + 60000).toISOString() } };
      });
    } });
    await flush(); check();
    video.duration = 30; video.fire('loadedmetadata');
    video.currentTime = 6; video.fire('timeupdate'); check();
  }
  function idleDetail() {
    assert.equal(get('ottDemo').hidden, true); assert.equal(get('ottCatalog').hidden, false);
    assert.equal(video.src, ''); assert.equal(video.plays, 0);
    assert.equal(get('ottCaptionDisplay').textContent, ''); assert.equal(get('ottCaptionDisplay').hidden, true);
    assert.equal(get('ottWatchStatus').textContent, '');
    assert.equal(timers.size, 0);
  }
  function currentCaption(expectedLanguage) {
    assert.equal(get('ottDemo').hidden, false); assert.equal(get('ottVideoError').hidden, true);
    assert.equal(video.src, route + '/nodes/intro/delivery'); assert.equal(video.plays, 1);
    assert.equal(get('ottCaptionDisplay').textContent, 'Synthetic ' + expectedLanguage + ' current caption');
    assert.equal(get('ottCaptionDisplay').hidden, false); assert.equal(timers.size, 1);
  }
  function finish() { check(); assert.equal(scripts.length, 0); timers.clear(); }
  return { get, video, attempts, calls, counts, sessions, timers, check, ready, start, locale,
    resolveSession, idleDetail, currentCaption, finish };
}

test('01 a retired initial EN watch cannot issue a session after JA detail is ready', options, async () => {
  const f = fixture(), oldEN = deferred();
  try {
    const initialButton = await f.ready();
    assert.strictEqual(await f.start(oldEN), initialButton);
    assert.equal(initialButton.disabled, true);
    const jaButton = await f.locale('ja');
    assert.notStrictEqual(jaButton, initialButton); assert.equal(initialButton.isConnected, false);
    assert.deepEqual(f.counts(), { detail: 2, watch: 1, head: 3, session: 0 });
    oldEN.resolve(graph('en')); await flush(); f.check();
    assert.equal(f.sessions.length, 0,
      'CINEMA_INITIAL_LOCALE_RETIRED_WATCH: old EN success must not invoke playback-session after JA detail');
    f.idleDetail();
    assert.strictEqual(f.get('ottStartViewing'), jaButton); assert.equal(jaButton.disabled, false);
    assert.equal(initialButton.disabled, true, 'Retired finally must not mutate the old captured button');
    await f.start(graph('ja')); assert.equal(f.sessions.length, 1);
    await f.resolveSession(); f.currentCaption('ja');
    assert.deepEqual(f.counts(), { detail: 2, watch: 2, head: 3, session: 1 });
    assert.equal(f.attempts.fetch, 4); f.check();
  } finally { f.finish(); }
});

test('02 late initial rejection and finally leave the current JA pending button and ready playback unchanged', options, async () => {
  for (const settleAfterCurrent of [false, true]) {
    const f = fixture(), oldEN = deferred(), currentJA = deferred();
    try {
      const oldButton = await f.ready(); await f.start(oldEN);
      const currentButton = await f.locale('ja'); await f.start(currentJA);
      assert.equal(oldButton.isConnected, false); assert.equal(oldButton.disabled, true);
      assert.equal(currentButton.disabled, true);
      if (settleAfterCurrent) {
        currentJA.resolve(graph('ja')); await flush(); f.check();
        await f.resolveSession(); f.currentCaption('ja');
      }
      const before = f.counts(), source = f.video.src, plays = f.video.plays, timerCount = f.timers.size;
      oldEN.reject(new Error('Synthetic retired watch rejection')); await flush(); f.check();
      assert.strictEqual(f.get('ottStartViewing'), currentButton);
      assert.equal(oldButton.disabled, true, 'Stale finally cannot release its captured old button');
      assert.equal(f.get('ottWatchStatus').textContent, '', 'Stale catch cannot write current status');
      assert.deepEqual(f.counts(), before); assert.equal(f.video.src, source);
      assert.equal(f.video.plays, plays); assert.equal(f.timers.size, timerCount);
      if (!settleAfterCurrent) {
        assert.equal(currentButton.disabled, true, 'Old finally cannot unlock the new pending entry');
        f.idleDetail();
        currentJA.resolve(graph('ja')); await flush(); f.check();
        await f.resolveSession();
      }
      f.currentCaption('ja'); assert.equal(currentButton.disabled, false);
      assert.deepEqual(f.counts(), { detail: 2, watch: 2, head: 3, session: 1 });
      assert.equal(f.attempts.api, 4); assert.equal(f.attempts.fetch, 4); f.check();
    } finally { f.finish(); }
  }
});

test('03 EN JA EN locale ABA cannot revive an earlier initial EN request or trigger an automatic watch', options, async () => {
  const f = fixture(), firstEN = deferred();
  try {
    const firstButton = await f.ready(); await f.start(firstEN);
    const jaButton = await f.locale('ja'), finalEN = await f.locale('en');
    assert.notStrictEqual(finalEN, firstButton); assert.notStrictEqual(finalEN, jaButton);
    assert.equal(firstButton.isConnected, false); assert.equal(jaButton.isConnected, false);
    assert.deepEqual(f.counts(), { detail: 3, watch: 1, head: 3, session: 0 });
    firstEN.resolve(graph('en')); await flush(); f.check();
    assert.equal(f.sessions.length, 0, 'Effective-language equality must not revive a retired request');
    f.idleDetail(); assert.strictEqual(f.get('ottStartViewing'), finalEN);
    assert.equal(firstButton.disabled, true); assert.equal(finalEN.disabled, false);
    assert.equal(f.attempts.api, 4, 'Locale changes reload detail, not an automatic watch');
    await f.start(graph('en')); await f.resolveSession(); f.currentCaption('en');
    assert.deepEqual(f.counts(), { detail: 3, watch: 2, head: 3, session: 1 });
    assert.equal(f.attempts.api, 5); assert.equal(f.attempts.fetch, 4); f.check();
  } finally { f.finish(); }
});

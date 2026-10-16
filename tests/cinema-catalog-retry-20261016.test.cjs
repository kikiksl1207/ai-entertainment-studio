'use strict';
// AUTHOR UNRUN. Whole product/selected HTML; synthetic DOM and API only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/ott.js': { sha256: '036d5f8e2f443233809fe7fc3e4b9d9a56d8d58a4f228b3700d2c7572e72c38e', blob: '63f1bced28ed3f4b8bc4f3cce8d6c0275552b72f' },
    'ott/index.html': { sha256: 'f74b3be9cfed0d612cd338bacff06f58b9bc7c6eb559eaa58e27a53964ec0578', blob: 'dced362527d389f3201348909ac4617cdf6ad643' },
  }),
  current: Object.freeze({
    'pages/ott.js': { sha256: '67849c40848626d81a517be37fea424686589cd8b26381980d4d66c29acd5265', blob: '15b1db545f907899df0f87b76125394b5e8c6b69' },
    'ott/index.html': { sha256: '0d59c409a225e9c6ac6c0076f78872778fdcc491d9b782d456ccdb9fee7467fc', blob: '7623bb411ca880f9eeffb3e81fb5ef7868d5557f' },
  }),
});
const NAMES = Object.freeze([
  '01 catalog error offers one explicit retry and deduplicates native pending clicks',
  '02 locale replacement retires late success error and finally including ABA',
  '03 demo entry retires the catalog and return requires an explicit retry',
  '04 pagehide retires pending catalog and pageshow never dispatches a retry',
]);
const phase = process.env.CINEMA_CATALOG_RETRY_PHASE || 'current';
assert(Object.prototype.hasOwnProperty.call(PINS, phase), 'Only frozen profiles');
const explicitRoot = process.env.CINEMA_CATALOG_RETRY_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (phase === 'baseline') assert(explicitRoot, 'Baseline requires an owned capsule');
if (explicitRoot) {
  assert(/^[eE]:[\\/]/.test(sourceRoot));
  for (const shared of ['E:/Codex/LuminaStage/ai-entertainment-studio-git', 'E:/Codex/LuminaStage/story-completion-20261003'])
    assert.notEqual(sourceRoot.toLowerCase(), path.resolve(shared).toLowerCase());
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function source(file, rawPin) {
  if (explicitRoot) assert.match(rawPin || '', /^[a-f0-9]{64}$/i);
  const target = fs.realpathSync(path.join(sourceRoot, file));
  assert.equal(path.relative(sourceRoot, target).replace(/\\/g, '/'), file);
  const bytes = fs.readFileSync(target);
  assert(bytes.length > 0 && bytes.length <= 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')));
  assert.equal(sha(lf), PINS[phase][file].sha256);
  assert.equal(blob(Buffer.from(lf)), PINS[phase][file].blob);
  if (rawPin) assert.equal(sha(bytes), rawPin.toLowerCase());
  return lf;
}
const product = source('pages/ott.js', process.env.CINEMA_CATALOG_RETRY_JS_SHA);
const html = source('ott/index.html', process.env.CINEMA_CATALOG_RETRY_HTML_SHA);
const options = { timeout: 10000, concurrency: false };
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const ERROR_TITLES = Object.freeze({
  ko: '\uc791\ud488 \ubaa9\ub85d\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.',
  en: 'The catalog could not be loaded.',
  ja: '\u4f5c\u54c1\u4e00\u89a7\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
  'zh-Hans': '\u65e0\u6cd5\u52a0\u8f7d\u4f5c\u54c1\u5217\u8868\u3002',
  'zh-Hant': '\u7121\u6cd5\u8f09\u5165\u4f5c\u54c1\u5217\u8868\u3002',
});
const RETRY_LABELS = Object.freeze({
  ko: '\ub2e4\uc2dc \uc2dc\ub3c4', en: 'Try again', ja: '\u518d\u8a66\u884c',
  'zh-Hans': '\u91cd\u8bd5', 'zh-Hant': '\u91cd\u8a66',
});
const flush = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };

// Adapted node/event plumbing only, not imported old test registrations.
function createDOM() {
  let document;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' };
  const decode = value => value.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, key) => entities[key]);
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
      style: {}, hidden: false, disabled: false, value: '', id: '', _text: '',
      classList: {
        add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)),
        contains: value => classes.has(value),
        toggle(value, force) { const enabled = force === undefined ? !classes.has(value) : !!force;
          if (enabled) classes.add(value); else classes.delete(value); return enabled; },
      },
      setAttribute(name, value) {
        const string = String(value); this.attributes.set(name, string);
        if (name === 'hidden' || name === 'disabled') this[name] = true;
        else if (name === 'class') { classes.clear(); string.split(/\s+/).filter(Boolean).forEach(value => classes.add(value)); }
        else if (name === 'style') { this.style.cssText = string;
          for (const part of string.split(';')) { const colon = part.indexOf(':');
            if (colon >= 0) this.style[part.slice(0, colon).trim()] = part.slice(colon + 1).trim(); } }
        else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = string;
        else this[name === 'playsinline' ? 'playsInline' : name] = string;
      },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      removeAttribute(name) { this.attributes.delete(name); if (name === 'hidden' || name === 'disabled') this[name] = false;
        else if (name === 'src') this.src = ''; },
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
      fire(type, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...extra };
        for (const callback of [...(listeners.get(type) || [])]) callback(event); },
      click() { if (!this.disabled) this.fire('click'); },
      focus() { document.activeElement = this; }, scrollIntoView() {},
      append(...nodes) { for (const child of nodes) { child.remove(); child.parentNode = this; this.children.push(child); } },
      appendChild(child) { this.append(child); return child; },
      replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null;
        this.children = []; this._text = ''; this.append(...nodes); },
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } },
      replaceWith(replacement) { const parent = this.parentNode; if (!parent) return;
        const index = parent.children.indexOf(this); replacement.remove(); parent.children[index] = replacement;
        replacement.parentNode = parent; this.parentNode = null; },
      contains(child) { return child === this || this.children.some(node => node.contains(child)); },
      getClientRects() { for (let node = this; node; node = node.parentNode) if (node.hidden || node.style.display === 'none') return [];
        return this.isConnected ? [{}] : []; },
      querySelectorAll(selector) {
        const result = [], groups = selector.split(',').map(value => value.trim().split(/\s+/));
        const walk = node => { for (const child of node.children) {
          if (groups.some(parts => {
            if (!matches(child, parts.at(-1))) return false;
            let ancestor = child.parentNode;
            for (let index = parts.length - 2; index >= 0; index--) {
              while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parentNode;
              if (!ancestor) return false; ancestor = ancestor.parentNode;
            }
            return true;
          })) result.push(child);
          walk(child);
        } }; walk(this); return result;
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
    const input = markup.replace(/<!--[\s\S]*?-->/g, ''), stack = [parent];
    let end = 0;
    for (const token of input.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
      stack.at(-1)._text += decode(input.slice(end, token.index)); end = token.index + token[0].length;
      const tag = token[1].toLowerCase();
      if (token[0].startsWith('</')) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
        continue;
      }
      const node = element(tag);
      const attrs = token[0].slice(token[0].indexOf(token[1]) + token[1].length).replace(/\/?\s*>$/, '');
      for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(attr[1].toLowerCase(), decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
      }
      stack.at(-1).append(node);
      if (!voidTags.has(tag) && !/\/\s*>$/.test(token[0])) stack.push(node);
    }
    stack.at(-1)._text += decode(input.slice(end));
  }
  document = element('#document');
  document.activeElement = null; document.fullscreenElement = null; document.hidden = false;
  document.createElement = element;
  document.getElementById = id => document.querySelector('#' + id);
  parse(html, document); document.body = document.querySelector('body');
  assert(document.body, 'Actual selected HTML body');
  return { document, element };
}


function item(slug = 'synthetic-current') {
  const localized = field => Object.fromEntries(locales.map(language => [language, field + ' ' + language + ' ' + slug]));
  return { slug, title: localized('Title'), synopsis: localized('Synopsis'), creatorName: localized('Creator'),
    publishedAt: '2026-10-16T00:00:00.000Z', posterPath: '', viewing: { available: false } };
}
function fixture(initialLanguage = 'en') {
  let language = initialLanguage;
  const { document, element } = createDOM(), window = element('window');
  const get = id => { const node = document.getElementById(id); assert(node, 'Actual HTML ID: ' + id); return node; };
  const root = get('ottCatalogRoot'), catalog = get('ottCatalog'), video = get('ottDemoVideo');
  const plans = [], gates = [], calls = [], faults = [];
  const attempts = { api: 0, fetch: 0, head: 0, captions: 0, storage: 0, timers: 0,
    media: 0, external: 0, src: 0 };
  const branches = [
    '/assets/ott/mothers-choice/02-branch-embrace-original.mp4',
    '/assets/ott/mothers-choice/03-branch-ignore.mp4',
    '/assets/ott/mothers-choice/04-branch-daughter-resists-final.mp4',
  ];
  const heads = new Map(branches.map(url => [url, 1])), captions = [];
  let demos = 0, demoLocaleReads = 0;
  function admit(callback) {
    try { return callback(); } catch (error) { faults.push('FIXTURE_ADMISSION_FAULT'); throw error; }
  }
  function denied(kind) { attempts[kind]++; return admit(() => assert.fail('Unplanned synthetic ' + kind)); }
  function queue(next = language) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const gate = { language: next, started: false, closed: false, decided: false,
      resolve(value) { assert(!gate.decided); gate.decided = true; resolve(value); },
      reject() { assert(!gate.decided); gate.decided = true;
        reject(Object.assign(new Error('SYNTHETIC_PRIVATE_FAILURE_MARKER'), { status: 503 })); },
      promise };
    plans.push(gate); gates.push(gate); return gate;
  }
  const initial = queue();
  const apiFetch = async (url, opts) => {
    attempts.api++;
    const gate = admit(() => {
      assert(attempts.api <= 8 && plans.length > 0, 'Every attempt has a plan before validation');
      assert.equal(url, '/api/v1/ott', 'Only free list GET seam, never detail/watch/session/auth');
      assert.deepEqual(Object.keys(opts || {}), ['throwOnError']); assert.equal(opts.throwOnError, true);
      const next = plans.shift(); assert.equal(next.language, language);
      next.started = true; calls.push({ kind: 'catalog', language }); return next;
    });
    // Scripted response failures are intentionally outside admission validation.
    try { return await gate.promise; } finally { gate.closed = true; }
  };
  const fetch = async (url, opts = {}) => {
    attempts.fetch++;
    return admit(() => {
      if (opts.method === 'HEAD') {
        attempts.head++;
        assert.deepEqual(Object.keys(opts).sort(), ['cache', 'method']); assert.equal(opts.cache, 'no-store');
        const remaining = heads.get(url) || 0; assert(remaining > 0, 'Only planned original demo HEADs');
        heads.set(url, remaining - 1); calls.push({ kind: 'head' });
        return { ok: true, headers: { get(name) { return admit(() => {
          assert(['content-type', 'content-length'].includes(name));
          return name === 'content-type' ? 'video/mp4' : '100';
        }); } } };
      }
      attempts.captions++;
      assert.deepEqual(Object.keys(opts), []); assert.equal(url, captions.shift(), 'Only original demo caption read');
      calls.push({ kind: 'caption' }); return { ok: false };
    });
  };
  let mediaSrc = '';
  function mediaCall(kind) { attempts.media++; return admit(() => { assert(demos > 0, 'Only explicitly opened demo media seam');
    calls.push({ kind }); }); }
  Object.assign(video, { paused: true, ended: false, muted: false, currentTime: 0, duration: NaN, textTracks: [],
    pause() { mediaCall('pause'); this.paused = true; },
    load() { mediaCall('load'); },
    play() { mediaCall('play'); this.paused = false; return Promise.resolve(); } });
  Object.defineProperties(video, {
    src: { get() { return mediaSrc; }, set(value) { attempts.src++; admit(() => {
      assert(demos > 0); assert.equal(value, '/assets/ott/mothers-choice/01-common-to-choice.mp4');
      mediaSrc = value; calls.push({ kind: 'src' });
    }); } },
    currentSrc: { get() { return mediaSrc; } },
  });
  window.LuminaI18n = { getLocale: () => language };
  const external = () => denied('external');
  const context = vm.createContext({ document, window, location: { search: '' },
    navigator: { language: 'en', maxTouchPoints: 0, sendBeacon: external }, screen: {}, API_BASE: '',
    apiFetch, fetch, URL, URLSearchParams, Blob, AbortController,
    localStorage: { getItem() { return denied('storage'); }, setItem() { return denied('storage'); },
      removeItem() { return denied('storage'); } },
    setTimeout() { return denied('timers'); }, clearTimeout() { return denied('timers'); },
    setInterval() { return denied('timers'); }, clearInterval() { return denied('timers'); },
    XMLHttpRequest: external, WebSocket: external, EventSource: external, Worker: external,
    console: { log: external, info: external, warn: external, error: external } });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  function check() {
    assert.deepEqual(faults, [], 'Admission faults remain visible outside product catches');
    assert.equal(attempts.api, calls.filter(call => call.kind === 'catalog').length);
    assert.equal(attempts.fetch, calls.filter(call => ['head', 'caption'].includes(call.kind)).length);
    assert.equal(attempts.head, 3 + demos * 3, 'Bootstrap3 and original demo3, no retry HEADs');
    assert.equal(attempts.captions, demos + demoLocaleReads, 'Only original demo entry/locale captions, no retry calls');
    assert.equal([...heads.values()].reduce((sum, n) => sum + n, 0), 0);
    assert.equal(captions.length, 0);
    for (const key of ['storage', 'timers', 'external']) assert.equal(attempts[key], 0, key);
    if (!demos) { assert.equal(attempts.media, 0); assert.equal(attempts.src, 0); }
    assert(!root.textContent.includes('SYNTHETIC_PRIVATE_FAILURE_MARKER'));
  }
  async function settled() { await flush(); check(); }
  async function changeLocale(next) {
    assert(locales.includes(next));
    if (!get('ottDemo').hidden) {
      demoLocaleReads++;
      captions.push('/assets/ott/mothers-choice/subtitles/common.' + next + '.vtt');
    }
    language = next;
    window.fire('lumina:localechange'); await settled();
  }
  async function openDemo() {
    demos++; for (const url of branches) heads.set(url, (heads.get(url) || 0) + 1);
    captions.push('/assets/ott/mothers-choice/subtitles/common.' + language + '.vtt');
    get('ottOpenDemo').click(); await settled();
    assert.equal(get('ottDemo').hidden, false);
  }
  async function back() { get('ottBackToList').click(); await settled(); assert.equal(get('ottDemo').hidden, true); }
  async function lifecycle(type) { window.fire(type, { persisted: true }); await settled(); }
  function finish() {
    check(); assert.equal(plans.length, 0); assert(gates.every(gate => gate.started && gate.closed && gate.decided));
  }
  return { document, get, root, catalog, video, calls, attempts, initial, queue, settled, changeLocale,
    openDemo, back, lifecycle, check, finish,
    retry: () => document.getElementById('ottCatalogRetry'),
    recovery: () => document.getElementById('ottCatalogRecovery'),
    visible: node => !!node && node.getClientRects().length > 0 };
}
function errorSurface(f, language) {
  assert.equal(f.visible(f.catalog), true);
  assert.equal(f.root.querySelector('.ott-status strong')?.textContent, ERROR_TITLES[language]);
  assert.equal(f.recovery().parentNode, f.catalog);
  assert.equal(f.retry().parentNode, f.recovery());
  assert.equal(f.recovery().hidden, false);
  assert.equal(f.visible(f.retry()), true); assert.equal(f.retry().disabled, false);
  assert.equal(f.retry().textContent, RETRY_LABELS[language]);
  assert.equal(f.root.querySelectorAll('.ott-card').length, 0);
}
function cards(f, value, language) {
  assert.equal(f.visible(f.catalog), true);
  assert.equal(f.root.querySelectorAll('.ott-card').length, 1);
  assert.equal(f.root.querySelector('h3 a').textContent, value.title[language]);
  assert.equal(f.root.querySelector('.ott-status'), null);
  assert.equal(f.recovery().hidden, true); assert.equal(f.visible(f.retry()), false);
}
function pending(f) {
  assert.equal(f.visible(f.catalog), true); assert.equal(f.visible(f.retry()), true);
  assert.equal(f.recovery().hidden, false); assert.equal(f.retry().parentNode, f.recovery());
  assert.equal(f.retry().disabled, true);
}
test(NAMES[0], options, async () => {
  for (const language of locales) {
    const f = fixture(language);
    try {
      f.initial.reject(); await f.settled();
      assert(f.visible(f.retry()) && !f.retry().disabled, 'PUBLIC_OTT_CATALOG_RETRY_MISSING');
      errorSurface(f, language);
      const retry = f.queue(), before = f.attempts.api, heads = f.attempts.head;
      f.retry().click(); pending(f);
      f.retry().click(); f.retry().click(); await f.settled();
      assert.equal(f.attempts.api, before + 1, 'Disabled duplicate clicks must not dispatch');
      assert.equal(f.attempts.head, heads, 'Retry adds no availability HEAD');
      const value = item('explicit-current');
      retry.resolve({ items: language === 'ko' ? [] : [value] }); await f.settled();
      if (language === 'ko') { assert.equal(f.catalog.hidden, true); assert.equal(f.recovery().hidden, true);
        assert.equal(f.visible(f.retry()), false); }
      else cards(f, value, language);
      assert.equal(f.retry().disabled, false); assert.equal(f.attempts.api, 2);
    } finally { f.finish(); }
  }
});
if (phase === 'current') {
  test(NAMES[1], options, async () => {
    for (const aba of [false, true]) for (const oldFailure of [false, true]) {
      const f = fixture();
      try {
        f.initial.reject(); await f.settled();
        const old = f.queue('en'); f.retry().click(); await f.settled();
        const ja = f.queue('ja'); await f.changeLocale('ja');
        let latest = ja, language = 'ja';
        if (aba) { latest = f.queue('en'); language = 'en'; await f.changeLocale('en'); }
        pending(f); const pendingText = f.root.textContent;
        if (oldFailure) old.reject(); else old.resolve({ items: [item('stale-en')] });
        await f.settled(); pending(f); assert.equal(f.root.textContent, pendingText, 'Old success/error/finally owns no current DOM or pending lock');
        const value = item('latest-ticket'); latest.resolve({ items: [value] }); await f.settled(); cards(f, value, language);
        if (aba) {
          if (oldFailure) ja.resolve({ items: [item('stale-ja')] }); else ja.reject();
          await f.settled(); cards(f, value, language); assert.equal(f.retry().disabled, false);
        }
        assert.equal(f.attempts.api, aba ? 4 : 3); assert.equal(f.attempts.head, 3);
      } finally { f.finish(); }
    }
  });
  test(NAMES[2], options, async () => {
    for (const oldOutcome of ['late-success', 'late-error', 'retained-error']) {
      const f = fixture();
      try {
        if (oldOutcome === 'retained-error') { f.initial.reject(); await f.settled(); errorSurface(f, 'en'); }
        await f.settled(); await f.openDemo(); const before = f.attempts.api;
        assert.equal(f.catalog.hidden, true);
        await f.changeLocale('ja');
        assert.equal(f.attempts.api, before, 'Locale inside demo must not retry the catalog');
        if (oldOutcome === 'late-error') f.initial.reject();
        else if (oldOutcome === 'late-success') f.initial.resolve({ items: [item('stale-behind-demo')] });
        await f.settled(); assert.equal(f.catalog.hidden, true, 'Late catalog must not unhide behind demo');
        await f.back(); assert.equal(f.attempts.api, before, 'Return is not automatic retry'); errorSurface(f, 'ja');
        const retry = f.queue(), headBefore = f.attempts.head, mediaBefore = f.attempts.media;
        f.retry().click(); pending(f); const value = item('after-explicit-return');
        retry.resolve({ items: [value] }); await f.settled(); cards(f, value, 'ja');
        assert.equal(f.attempts.api, before + 1); assert.equal(f.attempts.head, headBefore);
        assert.equal(f.attempts.media, mediaBefore);
      } finally { f.finish(); }
    }
  });
  test(NAMES[3], options, async () => {
    for (const oldFailure of [false, true]) {
      const f = fixture();
      try {
        f.initial.reject(); await f.settled();
        const old = f.queue(); f.retry().click(); await f.settled(); pending(f);
        await f.lifecycle('pagehide'); const before = f.attempts.api;
        assert.equal(f.catalog.hidden, true);
        f.retry().click(); await f.settled(); assert.equal(f.attempts.api, before, 'Inactive document cannot dispatch');
        await f.lifecycle('pageshow'); assert.equal(f.attempts.api, before, 'Pageshow is display-only'); errorSurface(f, 'en');
        const current = f.queue(); f.retry().click(); await f.settled(); pending(f);
        await f.lifecycle('pageshow'); pending(f); assert.equal(f.attempts.api, before + 1);
        const pendingText = f.root.textContent;
        if (oldFailure) old.reject(); else old.resolve({ items: [item('stale-before-pagehide')] });
        await f.settled(); pending(f); assert.equal(f.root.textContent, pendingText);
        current.resolve({ items: [] }); await f.settled();
        assert.equal(f.catalog.hidden, true); assert.equal(f.recovery().hidden, true);
        assert.equal(f.visible(f.retry()), false);
        assert.equal(f.retry().disabled, false); assert.equal(f.attempts.api, before + 1);
        assert.equal(f.attempts.head, 3);
      } finally { f.finish(); }
    }
  });
}

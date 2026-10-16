'use strict';
// AUTHOR UNRUN. Whole pinned consumer and HTML; only DOM/API/media seams are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/ott.js': Object.freeze({ sha256: '237efc9aa1eec8894d0163a60523a50348e535957f47e65e90f66ff9287892d0', blob: 'fae9f04ade7083f6a0e1d897e6c9e15fd8a88a2c' }),
    'ott/index.html': Object.freeze({ sha256: 'cf83b7696b20f88e2703597572a1c64aba1589f4a119b9bd0a3992ba38047cc1', blob: '12086715b3070b71ad477cf8c441699e75079913' }),
  }),
  current: Object.freeze({
    'pages/ott.js': Object.freeze({ sha256: '67849c40848626d81a517be37fea424686589cd8b26381980d4d66c29acd5265', blob: '15b1db545f907899df0f87b76125394b5e8c6b69' }),
    'ott/index.html': Object.freeze({ sha256: '0d59c409a225e9c6ac6c0076f78872778fdcc491d9b782d456ccdb9fee7467fc', blob: '7623bb411ca880f9eeffb3e81fb5ef7868d5557f' }),
  }),
});
const NAMES = Object.freeze([
  '01 malformed successful catalog is unavailable instead of silently hidden',
  '02 malformed catalog shapes use the existing error in all five UI locales',
  '03 healthy empty and populated catalogs keep their original cards and fields',
  '04 ordinary rejection explicit locale recovery and detail success stay unchanged',
]);
const phase = process.env.CINEMA_CATALOG_SHAPE_PHASE || 'current';
assert(Object.prototype.hasOwnProperty.call(PINS, phase), 'Only frozen source profiles');
const explicitRoot = process.env.CINEMA_CATALOG_SHAPE_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (phase === 'baseline') assert(explicitRoot, 'Baseline requires an explicit owned source capsule');
if (explicitRoot) {
  assert(/^[eE]:[\\/]/.test(sourceRoot), 'Explicit QA source stays on E');
  for (const shared of ['E:/Codex/LuminaStage/ai-entertainment-studio-git', 'E:/Codex/LuminaStage/story-completion-20261003']) {
    assert.notEqual(sourceRoot.toLowerCase(), path.resolve(shared).toLowerCase(), 'No explicit shared source');
  }
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function source(file, rawPin) {
  if (explicitRoot) assert.match(rawPin || '', /^[a-f0-9]{64}$/i, 'Explicit capsule requires raw byte pins');
  const target = path.join(sourceRoot, file);
  const real = fs.realpathSync(target);
  assert.equal(path.relative(sourceRoot, real).replace(/\\/g, '/'), file, 'No source junction escape');
  const bytes = fs.readFileSync(target);
  assert(bytes.length > 0 && bytes.length <= 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes), 'Lossless non-BOM UTF-8');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')), 'Uniform LF or CRLF only');
  assert.equal(sha(lf), PINS[phase][file].sha256);
  assert.equal(blob(Buffer.from(lf)), PINS[phase][file].blob);
  if (rawPin) assert.equal(sha(bytes), rawPin.toLowerCase());
  return lf;
}
const product = source('pages/ott.js', process.env.CINEMA_CATALOG_SHAPE_JS_SHA);
const html = source('ott/index.html', process.env.CINEMA_CATALOG_SHAPE_HTML_SHA);
const options = { timeout: 10000, concurrency: false };
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const ERROR_TITLES = Object.freeze({
  ko: '\uc791\ud488 \ubaa9\ub85d\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.',
  en: 'The catalog could not be loaded.',
  ja: '\u4f5c\u54c1\u4e00\u89a7\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002',
  'zh-Hans': '\u65e0\u6cd5\u52a0\u8f7d\u4f5c\u54c1\u5217\u8868\u3002',
  'zh-Hant': '\u7121\u6cd5\u8f09\u5165\u4f5c\u54c1\u5217\u8868\u3002',
});
const flush = async () => { for (let index = 0; index < 64; index++) await Promise.resolve(); };

// DOM/event plumbing is adapted from the pinned initial-locale fixture, never imported.
// Text preservation here models nodes, not catalog admission or rendering decisions.
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

function catalogItem(slug = 'synthetic-one') {
  const localized = field => Object.fromEntries(locales.map(language => [language, `Synthetic <${field}> & ${language} ${slug}`]));
  return { slug, title: localized('title'), synopsis: localized('synopsis'), creatorName: localized('studio'),
    publishedAt: '2026-10-16T00:00:00.000Z', posterPath: '', viewing: { available: false } };
}

function fixture(response, { language = 'en', search = '', rejection = false } = {}) {
  const { document, element } = createDOM(), window = element('window');
  const get = id => { const node = document.getElementById(id); assert(node, 'Actual HTML ID: ' + id); return node; };
  const root = get('ottCatalogRoot'), catalog = get('ottCatalog'), browse = get('ottBrowse'), video = get('ottDemoVideo');
  const initialStatus = root.querySelector('.ott-status');
  const faults = [], calls = [], plans = [{ response, rejection, language }];
  const attempts = { api: 0, fetch: 0, storage: 0, timers: 0, media: 0, external: 0 };
  const heads = new Set([
    '/assets/ott/mothers-choice/02-branch-embrace-original.mp4',
    '/assets/ott/mothers-choice/03-branch-ignore.mp4',
    '/assets/ott/mothers-choice/04-branch-daughter-resists-final.mp4',
  ]);
  function admit(run) { try { return run(); } catch (error) { faults.push('FIXTURE_ADMISSION_FAULT'); throw error; } }
  function denied(kind) { attempts[kind]++; return admit(() => assert.fail('Unplanned synthetic ' + kind)); }
  const apiFetch = async (url, opts) => {
    attempts.api++;
    const plan = admit(() => {
      assert(attempts.api <= 3 && plans.length > 0, 'Every API call is explicitly planned');
      assert.deepEqual(Object.keys(opts || {}), ['throwOnError']); assert.equal(opts.throwOnError, true);
      const plan = plans.shift(); assert.equal(plan.language, language);
      const slug = new URLSearchParams(search).get('title');
      assert.equal(url, slug ? '/api/v1/ott/' + encodeURIComponent(slug) : '/api/v1/ott');
      calls.push({ kind: slug ? 'detail' : 'catalog', language }); return plan;
    });
    // Intentional service rejection is separate from fixture admission validation.
    if (plan.rejection) throw Object.assign(new Error('SYNTHETIC_NOT_DISPLAYABLE_FAILURE'), { status: 503 });
    return structuredClone(plan.response);
  };
  const fetch = (url, opts = {}) => {
    attempts.fetch++;
    return admit(() => {
      assert.equal(opts.method, 'HEAD'); assert.equal(opts.cache, 'no-store');
      assert.deepEqual(Object.keys(opts).sort(), ['cache', 'method']);
      assert(heads.has(url), 'Only existing initial availability HEAD fixture'); heads.delete(url);
      calls.push({ kind: 'head' });
      return Promise.resolve({ ok: true, headers: { get(name) { return admit(() => {
        assert(['content-type', 'content-length'].includes(name)); return name === 'content-type' ? 'video/mp4' : '100';
      }); } } });
    });
  };
  Object.assign(video, { paused: true, ended: false, muted: false, currentTime: 0, duration: NaN,
    textTracks: [], load() { return denied('media'); }, play() { return denied('media'); }, pause() { return denied('media'); } });
  Object.defineProperties(video, {
    src: { get() { return ''; }, set() { return denied('media'); } },
    currentSrc: { get() { return ''; } },
  });
  window.LuminaI18n = { getLocale: () => language };
  const external = function () { return denied('external'); };
  const context = vm.createContext({ document, window, location: { search }, navigator: { language: 'en', maxTouchPoints: 0,
    sendBeacon: external }, screen: {}, API_BASE: '', apiFetch, fetch,
    localStorage: { getItem() { return denied('storage'); }, setItem() { return denied('storage'); }, removeItem() { return denied('storage'); } },
    setTimeout() { return denied('timers'); }, clearTimeout() { return denied('timers'); },
    setInterval() { return denied('timers'); }, clearInterval() { return denied('timers'); },
    XMLHttpRequest: external, WebSocket: external, EventSource: external, Worker: external,
    URL, URLSearchParams, Blob, AbortController,
    console: { log: external, warn: external, error: external, info: external },
  });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  function check() {
    assert.deepEqual(faults, [], 'Fixture faults must remain outside product catches');
    assert.equal(attempts.api, calls.filter(call => call.kind !== 'head').length);
    assert.equal(attempts.fetch, calls.filter(call => call.kind === 'head').length);
    assert.equal(attempts.fetch, 3); assert.equal(heads.size, 0);
    for (const key of ['storage', 'timers', 'media', 'external']) assert.equal(attempts[key], 0, key);
  }
  async function settled() { await flush(); check(); assert.equal(plans.length, 0); }
  async function changeLocale(next, value) {
    assert(locales.includes(next) && next !== language); plans.push({ response: value, rejection: false, language: next });
    language = next; window.fire('lumina:localechange'); await settled();
  }
  function finish() { check(); assert.equal(plans.length, 0); }
  return { get, root, catalog, browse, video, document, initialStatus, calls, attempts, settled, changeLocale, finish,
    visible: node => !!node && node.getClientRects().length > 0 };
}

function assertError(f, language) {
  assert.equal(f.visible(f.catalog), true);
  const title = f.root.querySelector('.ott-status strong');
  assert.equal(f.visible(title), true); assert.equal(title.textContent, ERROR_TITLES[language]);
  assert(f.root.querySelector('.ott-status p')?.textContent.trim());
  assert.equal(f.root.querySelectorAll('.ott-card').length, 0);
  assert(!f.root.textContent.includes('SYNTHETIC_NOT_DISPLAYABLE'));
  assert.equal(f.get('ottDemo').hidden, true); assert.equal(f.video.src, '');
}

test(NAMES[0], options, async () => {
  const f = fixture({});
  try {
    await f.settled();
    assert.equal(f.visible(f.catalog), true, 'CINEMA_CATALOG_SHAPE_MALFORMED_HIDDEN');
    assertError(f, 'en'); assert.equal(f.attempts.api, 1);
  } finally { f.finish(); }
});

if (phase === 'current') {
  test(NAMES[1], options, async () => {
    const malformed = [null, false, 7, 'SYNTHETIC_NOT_DISPLAYABLE', [], {}, { items: null }, { items: { raw: 'SYNTHETIC_NOT_DISPLAYABLE' } }];
    for (const language of locales) for (const response of malformed) {
      const f = fixture(response, { language });
      try { await f.settled(); assertError(f, language); assert.equal(f.attempts.api, 1); }
      finally { f.finish(); }
    }
  });

  test(NAMES[2], options, async () => {
    for (const language of locales) {
      const empty = fixture({ items: [] }, { language });
      try {
        await empty.settled(); assert.equal(empty.catalog.hidden, true); assert.equal(empty.visible(empty.browse), true);
        assert.equal(empty.root.querySelector('.ott-status'), empty.initialStatus);
        assert.equal(empty.visible(empty.initialStatus), false); assert.equal(empty.attempts.api, 1);
      } finally { empty.finish(); }
      const items = [catalogItem(), catalogItem('synthetic-two')], before = structuredClone(items);
      items[1].posterPath = '/assets/ott/synthetic-two/poster.webp'; before[1].posterPath = items[1].posterPath;
      const full = fixture({ items }, { language });
      try {
        await full.settled(); assert.equal(full.visible(full.catalog), true);
        const cards = full.root.querySelectorAll('.ott-card'); assert.equal(cards.length, 2);
        cards.forEach((card, index) => {
          assert.equal(card.querySelector('h3 a').textContent, items[index].title[language]);
          assert.equal(card.querySelector('.ott-card-body p').textContent, items[index].synopsis[language]);
          assert(card.querySelector('.ott-card-meta').textContent.includes(items[index].creatorName[language]));
          assert.equal(card.querySelector('h3 a').getAttribute('href'), '/ott?title=' + items[index].slug);
        });
        assert.equal(cards[1].querySelector('img').getAttribute('src'), items[1].posterPath);
        assert.deepEqual(items, before); assert.equal(full.root.querySelector('.ott-status'), null);
        assert.equal(full.attempts.api, 1);
      } finally { full.finish(); }
    }
  });

  test(NAMES[3], options, async () => {
    const failed = fixture(undefined, { rejection: true });
    try {
      await failed.settled(); assertError(failed, 'en'); assert.equal(failed.attempts.api, 1);
      const item = catalogItem(); await failed.changeLocale('ja', { items: [item] });
      assert.equal(failed.root.querySelector('h3 a').textContent, item.title.ja);
      assert.equal(failed.root.querySelector('.ott-status'), null); assert.equal(failed.attempts.api, 2);
    } finally { failed.finish(); }
    const item = catalogItem('synthetic-detail');
    item.viewing = { available: true, watchPath: '/api/v1/ott/synthetic-detail/watch' };
    const detail = fixture(item, { search: '?title=synthetic-detail' });
    try {
      await detail.settled(); assert.equal(detail.visible(detail.catalog), true);
      assert.equal(detail.root.querySelector('h2').textContent, item.title.en);
      assert.equal(detail.visible(detail.get('ottStartViewing')), true);
      assert.equal(detail.get('ottStartViewing').disabled, false);
      assert.equal(detail.root.querySelector('.ott-status'), null);
      assert.deepEqual(detail.calls.filter(call => call.kind !== 'head').map(call => call.kind), ['detail']);
    } finally { detail.finish(); }
  });
}

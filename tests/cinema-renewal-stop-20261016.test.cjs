'use strict';
// AUTHOR UNRUN. Whole immutable consumer/HTML; no old test import or private epoch access.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const PINS = Object.freeze({
  baseline: {
    'pages/ott.js': { sha256: 'b85518b394f535f4f7cb685c733407ee5e1be66ae0aaa813c6fa8b4d2f2bf20a', gitBlob: '1dad5ceb210afd180cb884c2fbe7b02c53120557' },
    'ott/index.html': { sha256: '0236d4bebbe4f213e5955357ddec25616a659c698e6f70e7aa55aa7496f1006c', gitBlob: '65267e089cb985ecaa3eb212f504bae1d82c2ad7' },
  },
  current: {
    'pages/ott.js': { sha256: '67849c40848626d81a517be37fea424686589cd8b26381980d4d66c29acd5265', gitBlob: '15b1db545f907899df0f87b76125394b5e8c6b69' },
    'ott/index.html': { sha256: '0d59c409a225e9c6ac6c0076f78872778fdcc491d9b782d456ccdb9fee7467fc', gitBlob: '7623bb411ca880f9eeffb3e81fb5ef7868d5557f' },
  },
});
const phase = process.env.CINEMA_RENEWAL_STOP_PHASE || 'current';
assert(Object.prototype.hasOwnProperty.call(PINS, phase));
const explicitRoot = process.env.CINEMA_RENEWAL_STOP_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (explicitRoot) for (const root of ['E:/Codex/LuminaStage/ai-entertainment-studio-git',
  'E:/Codex/LuminaStage/story-completion-20261003']) {
  assert.notEqual(sourceRoot.toLowerCase(), path.resolve(root).toLowerCase(), 'No explicit shared working source');
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function source(file, rawPin) {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  assert(bytes.length > 0 && bytes.length <= 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')));
  assert.equal(sha(lf), PINS[phase][file].sha256);
  assert.equal(blob(Buffer.from(lf)), PINS[phase][file].gitBlob, 'Same canonical source variant');
  if (rawPin) assert.equal(sha(bytes), rawPin);
  return lf;
}
const product = source('pages/ott.js', process.env.CINEMA_RENEWAL_STOP_JS_SHA);
const html = source('ott/index.html', process.env.CINEMA_RENEWAL_STOP_HTML_SHA);
const tag = phase === 'baseline' ? 'ott-initial-locale-20261016' : 'ott-catalog-retry-20261016';
assert.equal(html.split('<script src="/pages/ott.js?v=' + tag + '"></script>').length, 2);
const slug = 'synthetic-renewal-stop', route = '/api/v1/ott/' + slug;
const origin = 'https://cinema.example.invalid';
const options = { timeout: 10000, concurrency: false };
const flush = async () => { for (let index = 0; index < 64; index++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// DOM-only helper copied from immutable Unit35 blob79ccd; no old registrations.
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


function graph(terminal) {
  const node = (key, choices) => ({
    key, clip: { startMs: 0, endMs: 5000 }, choices, subtitles: [],
    ending: choices.length ? null : { label: 'Synthetic current ending' },
    browserPlayback: { method: 'POST', sessionPath: route + '/nodes/' + key + '/playback-session' },
  });
  return { entryNodeKey: 'intro', nodes: terminal ? [node('intro', [])] : [
    node('intro', [{ targetNodeKey: 'branch', label: 'Synthetic next node' }]), node('branch', []),
  ] };
}
function fixture(terminal = false) {
  const { document, element } = createDOM();
  const get = id => { const node = document.getElementById(id); assert(node, 'Actual HTML node: ' + id); return node; };
  const video = get('ottDemoVideo'), window = element('window');
  let clock = Date.parse('2026-10-16T00:00:00.000Z'), timerId = 0, closed = false;
  const faults = [], calls = [], apiPlans = [], sessionPlans = [], sessions = [], timers = new Map(), knownTimers = new Set();
  const attempts = { api: 0, fetch: 0, timer: 0, timerClear: 0, body: 0, storage: 0 };
  const item = { slug, title: { en: 'Synthetic current title' }, synopsis: { en: 'Synthetic synopsis' },
    creatorName: { en: 'Synthetic studio' }, posterPath: '', viewing: { available: true, watchPath: route + '/watch' } };
  const heads = new Set([
    '/assets/ott/mothers-choice/02-branch-embrace-original.mp4',
    '/assets/ott/mothers-choice/03-branch-ignore.mp4',
    '/assets/ott/mothers-choice/04-branch-daughter-resists-final.mp4',
  ]);
  function admit(run) { try { return run(); } catch (error) { faults.push('Fixture admission failed'); throw error; } }
  apiPlans.push({ path: route, payload: item });
  Object.assign(video, {
    paused: true, ended: false, muted: false, currentTime: 0, duration: NaN, src: '', textTracks: [],
    loads: 0, plays: 0, pauses: 0,
    pause() { this.pauses++; this.paused = true; this.fire('pause'); },
    load() { this.loads++; this.currentTime = 0; this.duration = NaN; this.ended = false; },
    play() { this.plays++; this.paused = false; this.fire('play'); return Promise.resolve(); },
  });
  Object.defineProperty(video, 'currentSrc', { get() { return this.src; } });
  window.LuminaI18n = { getLocale: () => 'en' };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const apiFetch = async (url, opts) => {
    attempts.api++;
    return admit(() => {
      assert(!closed && attempts.api <= 4);
      assert.deepEqual(Object.keys(opts || {}), ['throwOnError']); assert.equal(opts.throwOnError, true);
      assert(apiPlans.length > 0, 'Every API call explicitly planned');
      const plan = apiPlans.shift(); assert.equal(url, plan.path);
      calls.push({ kind: 'api', path: url });
      return structuredClone(plan.payload);
    });
  };
  const fetch = (url, opts = {}) => {
    attempts.fetch++;
    return admit(() => {
      assert(!closed && attempts.fetch <= 12);
      if (heads.has(url)) {
        assert.deepEqual(Object.keys(opts).sort(), ['cache', 'method']);
        assert.equal(opts.method, 'HEAD'); assert.equal(opts.cache, 'no-store');
        calls.push({ kind: 'head' });
        return Promise.resolve(new Response(null, { status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '100' } }));
      }
      assert(sessionPlans.length > 0, 'No automatic or unplanned session allowed');
      const plan = sessionPlans.shift();
      assert.equal(url, origin + route + '/nodes/' + plan.key + '/playback-session');
      assert.deepEqual(Object.keys(opts).sort(), ['cache', 'credentials', 'method', 'signal']);
      assert.equal(opts.method, 'POST'); assert.equal(opts.credentials, 'include');
      assert.equal(opts.cache, 'no-store'); assert(opts.signal instanceof AbortSignal);
      plan.dispatched = true; plan.signal = opts.signal;
      plan.onAbort = () => {
        plan.aborts++;
        const error = new DOMException('Synthetic request deadline', 'AbortError');
        if (!plan.headersSent) plan.headers.reject(error);
        if (!plan.bodyClosed) { plan.bodyClosed = true; plan.stream.error(error); }
      };
      opts.signal.addEventListener('abort', plan.onAbort, { once: true });
      calls.push({ kind: 'session', key: plan.key }); sessions.push(plan);
      return plan.headers.promise;
    });
  };
  const context = vm.createContext({
    document, window, navigator: { language: 'en', maxTouchPoints: 0 }, screen: {},
    location: { search: '?title=' + slug }, API_BASE: origin, apiFetch, fetch,
    localStorage: {
      getItem() { attempts.storage++; return admit(() => assert.fail('No storage access')); },
      setItem() { attempts.storage++; return admit(() => assert.fail('No storage writes')); },
      removeItem() { attempts.storage++; return admit(() => assert.fail('No storage removal')); },
    },
    console: { log() {}, warn() { faults.push('Unexpected product warning'); }, error() { faults.push('Unexpected product error'); } },
    URL, URLSearchParams, Blob, AbortController, Date: Clock,
    setTimeout(callback, delay) {
      attempts.timer++;
      return admit(() => {
        assert(!closed && attempts.timer <= 64 && typeof callback === 'function');
        assert(Number.isFinite(delay) && delay >= 0 && delay <= 60000 && timers.size < 6);
        const id = ++timerId; knownTimers.add(id); timers.set(id, { callback, delay, due: clock + delay }); return id;
      });
    },
    clearTimeout(id) {
      attempts.timerClear++;
      return admit(() => {
        assert(Number.isSafeInteger(id) && knownTimers.has(id), 'Only an allocated timer may be cleared');
        timers.delete(id); // A fired/dequeued handle may legally be cleared again.
      });
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(product, context, { filename: 'selected/pages/ott.js', timeout: 5000 });
  function check() {
    assert.deepEqual(faults, [], 'Fixture faults cannot be swallowed by product catches');
    assert.equal(attempts.storage, 0);
    assert.equal(attempts.api, calls.filter(call => call.kind === 'api').length);
    assert.equal(attempts.fetch, calls.filter(call => call.kind === 'head' || call.kind === 'session').length);
    assert.equal(attempts.body, sessions.filter(plan => plan.bodyRead).length);
  }
  function planSession(key) {
    assert(['intro', 'branch'].includes(key)); assert.equal(sessionPlans.length, 0);
    const plan = { key, headers: deferred(), headersSent: false, bodyRead: false, bodyClosed: false,
      jsonSettled: false, dispatched: false, aborts: 0, signal: null, onAbort: null };
    const stream = new ReadableStream({ start(controller) { plan.stream = controller; } });
    plan.response = new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    const actualJson = plan.response.json.bind(plan.response);
    plan.response.json = async () => {
      attempts.body++;
      admit(() => { assert(plan.dispatched && plan.headersSent && !plan.bodyRead); plan.bodyRead = true; });
      try { return await actualJson(); }
      finally {
        plan.jsonSettled = true;
        if (plan.onAbort) plan.signal.removeEventListener('abort', plan.onAbort);
      }
    };
    plan.releaseHeaders = async () => {
      assert(plan.dispatched && !plan.headersSent && !plan.signal.aborted);
      plan.headersSent = true; plan.headers.resolve(plan.response); await flush(); check(); assert(plan.bodyRead);
    };
    plan.success = async () => {
      if (!plan.headersSent) await plan.releaseHeaders();
      assert(!plan.bodyClosed); plan.bodyClosed = true;
      const payload = { playback: { mode: 'secure_http_only_cookie',
        path: route + '/nodes/' + key + '/delivery', expiresAt: new Date(clock + 60000).toISOString() } };
      plan.stream.enqueue(new TextEncoder().encode(JSON.stringify(payload))); plan.stream.close();
      await flush(); check(); assert(plan.jsonSettled);
    };
    plan.failBody = async () => {
      if (!plan.headersSent) await plan.releaseHeaders();
      assert(!plan.bodyClosed); plan.bodyClosed = true;
      plan.stream.error(new Error('Synthetic scripted body failure'));
      await flush(); check(); assert(plan.jsonSettled);
    };
    sessionPlans.push(plan); return plan;
  }
  async function advance(ms) {
    assert(Number.isFinite(ms) && ms >= 0 && ms <= 120000);
    const end = clock + ms; let fired = 0;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= end)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      assert(++fired <= 24, 'Finite real callback budget');
      const [id, timer] = next; timers.delete(id); clock = timer.due;
      timer.callback(); await flush(); check();
    }
    clock = end; await flush(); check();
  }
  const delays = () => [...timers.values()].map(timer => timer.delay).sort((a, b) => a - b);
  const sessionCount = () => calls.filter(call => call.kind === 'session').length;
  function metadata(key) {
    assert.equal(video.src, origin + route + '/nodes/' + key + '/delivery');
    video.duration = 5; video.fire('loadedmetadata'); check();
    assert.equal(get('ottVideoError').hidden, true);
    assert.equal(get('ottSeek').disabled, false);
  }
  async function start(expectedOutstandingDeadline = false) {
    await flush(); check();
    const button = get('ottStartViewing'); assert(button.isConnected && !button.disabled);
    apiPlans.push({ path: route + '/watch?locale=en', payload: graph(terminal) });
    const plan = planSession('intro'); button.click(); await flush(); check(); assert(plan.dispatched);
    await plan.success(); metadata('intro');
    assert.deepEqual(delays(), expectedOutstandingDeadline ? [8000, 55000] : [55000]); return plan;
  }
  async function end() {
    video.currentTime = 5; video.ended = true; video.fire('timeupdate'); video.fire('ended');
    await flush(); check();
    assert.equal(get('ottChoiceOverlay').hidden, false);
    assert.equal(get('ottVideoError').hidden, true); assert.equal(video.paused, true);
  }
  async function nextNode() {
    const button = get('ottPublicChoices').querySelector('button');
    assert(button && button.isConnected && !button.disabled);
    const plan = planSession('branch'); button.click(); await flush(); check(); assert(plan.dispatched);
    await plan.success(); metadata('branch'); return plan;
  }
  async function restart() {
    const button = get('ottRestart'); assert(button.isConnected && !button.hidden);
    const plan = planSession('intro'); button.click(); await flush(); check(); assert(plan.dispatched);
    await plan.success(); metadata('intro'); return plan;
  }
  function dequeueRenewal() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0]; assert.equal(timer.delay, 55000);
    timers.delete(id); clock = timer.due;
    return async () => { timer.callback(); await flush(); check(); };
  }
  async function back() { get('ottBackToList').click(); await flush(); check(); }
  async function finish() {
    await back(); check();
    assert.equal(apiPlans.length, 0); assert.equal(sessionPlans.length, 0);
    assert.equal(timers.size, 0, 'Actual stop clears every product timer');
    assert(sessions.every(plan => plan.bodyClosed && plan.jsonSettled && plan.aborts === 0),
      'All admitted synthetic bodies settled without deadline cleanup masking');
    closed = true;
  }
  return { get, video, calls, sessions, attempts, check, planSession, advance, delays, sessionCount,
    start, end, nextNode, restart, dequeueRenewal, back, finish };
}

test('01 a pending renewal success cannot rearm after a terminal ending', options, async () => {
  const f = fixture(true);
  try {
    await f.start(); assert.equal(f.sessionCount(), 1);
    const old = f.planSession('intro'); await f.advance(55000); assert(old.dispatched);
    await old.releaseHeaders(); await f.end(); assert.deepEqual(f.delays(), [8000]);
    await old.success();
    assert.equal(f.delays().length, 0, 'PUBLIC_OTT_RENEWAL_REARMED_AFTER_ENDING');
    assert.equal(f.get('ottPublicEnding').textContent, 'Synthetic current ending');
    assert.equal(f.get('ottChoiceOverlay').hidden, false); assert.equal(f.get('ottVideoError').hidden, true);
    assert.equal(f.sessionCount(), 2);
    await f.advance(60000); assert.equal(f.sessionCount(), 2);
    await f.restart(); assert.equal(f.sessionCount(), 3); assert.deepEqual(f.delays(), [55000]);
  } finally { await f.finish(); }
});

test('02 retired renewal failures and already queued callbacks leave choices stopped and explicit next nodes usable', options, async () => {
  for (const expired of [false, true]) {
    const f = fixture(false);
    try {
      await f.start();
      const old = f.planSession('intro'); await f.advance(55000); await old.releaseHeaders();
      if (expired) await f.advance(6000);
      await f.end(); await old.failBody();
      assert.deepEqual(f.delays(), [], 'Retired failure must neither retry nor replace the choice UI');
      assert.equal(f.get('ottChoiceOverlay').hidden, false); assert.equal(f.get('ottVideoError').hidden, true);
      assert.equal(f.get('ottPublicChoices').querySelectorAll('button').length, 1);
      assert.equal(f.sessionCount(), 2);
      await f.nextNode(); assert.equal(f.sessionCount(), 3); assert.deepEqual(f.delays(), [55000]);
      const queued = f.dequeueRenewal(); await f.end(); assert.deepEqual(f.delays(), []);
      await queued(); assert.equal(f.sessionCount(), 3, 'A cleared but already queued callback must not dispatch');
      assert.deepEqual(f.delays(), []); assert.equal(f.get('ottVideoError').hidden, true);
      await f.advance(60000); assert.equal(f.sessionCount(), 3);
    } finally { await f.finish(); }
  }
});

test('03 current renewal retry and expiry remain while replaced playback ignores the older continuation', options, async () => {
  const f = fixture(false);
  try {
    await f.start();
    const normal = f.planSession('intro'); await f.advance(55000); await normal.success();
    assert.equal(f.sessionCount(), 2); assert.equal(f.video.loads, 1); assert.equal(f.video.plays, 1);
    assert.deepEqual(f.delays(), [55000]);
    const replaced = f.planSession('intro'); await f.advance(55000); await replaced.releaseHeaders();
    await f.back(); await f.start(true); assert.equal(f.sessionCount(), 4);
    const currentSource = f.video.src, currentLoads = f.video.loads;
    await replaced.success();
    assert.equal(f.video.src, currentSource); assert.equal(f.video.loads, currentLoads);
    assert.deepEqual(f.delays(), [55000]); assert.equal(f.get('ottVideoError').hidden, true);
    const early = f.planSession('intro'); await f.advance(55000); await early.failBody();
    assert.deepEqual(f.delays(), [3000], 'Current unexpired failure retains the original retry');
    const retry = f.planSession('intro'); await f.advance(3000); await retry.success();
    assert.equal(f.sessionCount(), 6); assert.deepEqual(f.delays(), [55000]);
    const expired = f.planSession('intro'); await f.advance(55000); await expired.releaseHeaders();
    await f.advance(6000); await expired.failBody();
    assert.equal(f.sessionCount(), 7); assert.deepEqual(f.delays(), []);
    assert.equal(f.get('ottVideoError').hidden, false); assert.equal(f.get('ottChoiceOverlay').hidden, true);
    assert.equal(f.video.paused, true);
  } finally { await f.finish(); }
});

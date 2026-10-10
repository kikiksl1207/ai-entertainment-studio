import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

// Full OTT IIFE and actual apiFetch; synthetic DOM/media/transport, not a browser, film, or account.
// The same spec uses its own tree's inputs. Baseline pins are provenance, not a GREEN admission gate.
export const baselineSourcePins = Object.freeze({
  ROOT: { path: 'E:/Codex/LuminaStage/ai-entertainment-studio-git/pages/ott.js',
    raw: '574a6dce99043b5896246fdd9acd4276b7df049067816bc5f6c41a7c259e4725',
    lf: '67314af65ebe829c770b7119107232bc1266a4f03a9e4f7f1c84b0c0e52a69b9' },
  CLEAN: { path: 'E:/Codex/LuminaStage/story-completion-20261003/pages/ott.js',
    raw: '0435e04b31c74282f73779fb61ba07fdaf1491c8e9d7a0af383465fdbdcf22ec',
    lf: 'c3d547044e5aadc320e846b1ce63025f7bff4c53c60ca2ba1d2e3f8d710639df' }
});
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceUrl = new URL('../pages/ott.js', import.meta.url);
const htmlUrl = new URL('../ott/index.html', import.meta.url);
const sharedUrl = new URL('../app.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const html = readFileSync(htmlUrl, 'utf8');
const shared = readFileSync(sharedUrl, 'utf8').replace(/\r\n/g, '\n');
export const inputPins = Object.freeze(Object.fromEntries([sourceUrl, htmlUrl, sharedUrl].map(url => {
  const bytes = readFileSync(url);
  return [fileURLToPath(url), { raw: sha(bytes), lf: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) }];
})));
const apiStart = shared.indexOf('async function apiFetch(');
assert.equal([...shared.matchAll(/^async function apiFetch\(/gm)].length, 1);
const apiEnd = shared.indexOf('\n}', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'actual shared apiFetch boundary');
const apiSource = shared.slice(apiStart, apiEnd + 2);
const prefix = 'OTT-DEMO-AVAILABILITY-CURRENT';
const redName = `${prefix}-RED: initial mother HEAD 200 cannot hide the public choice exit`;
const slug = 'synthetic-public-title';
const apiBase = 'https://cinema-api.fixture.invalid';
const siteBase = 'https://cinema-page.fixture.invalid';
const motherRoot = '/assets/ott/mothers-choice/';
const branchFiles = ['02-branch-embrace-original.mp4', '03-branch-ignore.mp4', '04-branch-daughter-resists-final.mp4'];
const branchKeys = ['embrace', 'ignore', 'hesitate'];
const outcomes = ['200', '404', 'throw'];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

// Existing focused supports use deferred requests and eventful synthetic elements.
// This bounded parser keeps the actual HTML ancestry/attributes, including hidden parents.
const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, (_, key) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  if (named[key]) return named[key];
  return String.fromCodePoint(key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
});
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.parentElement = null;
    this.children = []; this.attributes = new Map(); this.dataset = {}; this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.ownText = ''; this.value = ''; this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name);
        return force;
      }
    };
  }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.ownText = String(value); }
  get src() { const value = this.getAttribute('src'); return value ? new URL(value, siteBase).href : ''; }
  set src(value) { this.setAttribute('src', value); }
  set innerHTML(value) { this.replaceChildren(); parseMarkup(String(value), this, this.ownerDocument); }
  append(...children) {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = []; this.ownText = ''; this.append(...children);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  replaceWith(child) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this); child.remove(); child.parentElement = parent;
    parent.children[index] = child; this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') this.className = value;
    if (name === 'hidden' || name === 'disabled') this[name] = true;
    if (name === 'value') this.value = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden' || name === 'disabled') this[name] = false;
  }
  matchesSimple(selector) {
    const match = /^(\w+)?(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);
    assert.ok(match && match[0], `supported synthetic selector: ${selector}`);
    const [, tag, id, cls, attribute, value] = match;
    return (!tag || this.tagName === tag.toUpperCase()) && (!id || this.id === id) &&
      (!cls || this.classes.has(cls)) && (!attribute || (this.attributes.has(attribute) &&
        (value === undefined || this.getAttribute(attribute) === value)));
  }
  querySelectorAll(selector) {
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
    const groups = selector.split(',').map(value => value.trim().split(/\s+/));
    return descendants(this).filter(node => groups.some(parts => {
      if (!node.matchesSimple(parts.at(-1))) return false;
      let parent = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (parent && parent !== this && !parent.matchesSimple(parts[i])) parent = parent.parentElement;
        if (!parent || parent === this) return false;
        parent = parent.parentElement;
      }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ callback, once: Boolean(options.once) }); this.listeners.set(type, list);
  }
  async fire(type, event = {}) {
    const list = [...(this.listeners.get(type) || [])];
    this.listeners.set(type, list.filter(item => !item.once));
    await Promise.all(list.map(item => item.callback({ type, target: this, preventDefault() {}, ...event })));
  }
  click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  scrollIntoView() {}
  getClientRects() {
    for (let node = this; node; node = node.parentElement) if (node.hidden) return [];
    return [{ width: 320, height: 180 }];
  }
}
function parseMarkup(markup, parent, document) {
  const stack = [parent], voidTags = new Set(['area', 'base', 'br', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const withoutScripts = markup.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  for (const token of withoutScripts.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = /^<\/([\w-]+)\s*>$/.exec(token)?.[1];
      assert.equal(stack.at(-1).tagName, tag?.toUpperCase(), 'actual markup must have balanced ancestry');
      assert.ok(stack.length > 1); stack.pop();
    } else if (token.startsWith('<')) {
      const match = /^<([\w-]+)([\s\S]*?)\/?\s*>$/.exec(token);
      assert.ok(match, 'supported actual markup tag');
      const node = new Element(match[1], document);
      for (const attribute of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(attribute[1], decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
      }
      stack.at(-1).append(node);
      if (!voidTags.has(match[1].toLowerCase()) && !/\/\s*>$/.test(token)) stack.push(node);
    } else stack.at(-1).ownText += decode(token);
  }
  assert.equal(stack.length, 1, 'actual markup must close all non-void tags');
}

function detail() {
  return { slug, title: { ko: 'Synthetic public work' }, synopsis: { ko: 'Synthetic synopsis' },
    creatorName: { ko: 'Synthetic creator' }, publishedAt: '2026-09-29T00:00:00Z',
    viewing: { available: true, watchPath: `/api/v1/ott/${slug}/watch` } };
}
function watch() {
  const node = (key, choices, ending) => ({ key, clip: { startMs: 0, endMs: 5000 }, choices, ending,
    subtitles: [{ startMs: 0, endMs: 5000, text: `${key} synthetic caption` }],
    browserPlayback: { sessionPath: `/api/v1/ott/${slug}/nodes/${key}/playback-session`,
      method: 'POST', mode: 'secure_http_only_cookie' } });
  return { slug, locale: 'ko', viewing: { available: true }, entryNodeKey: 'intro', nodes: [
    node('intro', [{ key: 'next', label: 'Continue to ending', targetNodeKey: 'ending' }], null),
    node('ending', [], { key: 'finished', label: 'Synthetic public ending' })
  ] };
}
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => structuredClone(body), text: async () => String(body ?? '') });

async function boot(t, { publicDetail = true } = {}) {
  const document = new Element('document'); document.ownerDocument = document;
  document.createElement = tag => new Element(tag, document);
  document.getElementById = id => document.querySelector(`#${id}`);
  parseMarkup(html, document, document);
  document.body = document.querySelector('body'); document.hidden = false; document.fullscreenElement = null;
  const get = id => { const node = document.getElementById(id); assert.ok(node, `actual HTML node ${id}`); return node; };
  const overlay = get('ottChoiceOverlay');
  assert.equal(get('ottDemoChoices').parentElement, get('ottPublicChoices').parentElement);
  assert.equal(get('ottNoChoices').parentElement, get('ottPublicChoices').parentElement);
  assert.equal(get('ottChoiceBack').parentElement, get('ottPublicChoices').parentElement);
  assert.equal(overlay.querySelectorAll('[data-ott-branch]').length, 3);
  assert.equal(get('ottDemo').hidden, true);
  assert.equal(get('ottDemoChoices').hidden, false);
  assert.equal(get('ottPublicChoices').hidden, true);
  const video = get('ottDemoVideo');
  Object.assign(video, { currentTime: 0, duration: 5, paused: true, ended: false, muted: false, loadCount: 0,
    load() { this.loadCount++; this.currentTime = 0; this.paused = true; this.ended = false; },
    play() { this.paused = false; this.ended = false; return this.fire('play'); },
    pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) void this.fire('pause'); }
  });
  const location = { search: publicDetail ? `?title=${slug}` : '' };
  const window = new Element('window', document);
  window.LuminaI18n = { getLocale: () => 'ko' };
  const calls = [], heads = [], unexpected = [], timers = new Map(); let timerId = 0;
  const transport = (input, options = {}) => {
    const url = new URL(String(input), siteBase), method = options.method || 'GET';
    const call = { url: url.href, path: url.pathname + url.search, method, options }; calls.push(call);
    if (url.origin === siteBase && method === 'HEAD' && branchFiles.some(file => url.pathname === motherRoot + file)) {
      const pending = deferred(), record = { ...call, ...pending, settled: false }; heads.push(record);
      return pending.promise;
    }
    if (url.origin === siteBase && method === 'GET' &&
        /^\/assets\/ott\/mothers-choice\/subtitles\/(common|embrace|ignore|hesitate)\.ko\.vtt$/.test(url.pathname)) {
      return Promise.resolve(response('', 404));
    }
    if (url.origin === apiBase && method === 'GET') {
      assert.equal(options.headers?.Authorization, undefined, 'synthetic anonymous public read');
      if (url.pathname === '/api/v1/ott' && !url.search) return Promise.resolve(response({ items: [detail()] }));
      if (url.pathname === `/api/v1/ott/${slug}` && !url.search) return Promise.resolve(response(detail()));
      if (url.pathname === `/api/v1/ott/${slug}/watch` && url.search === '?locale=ko') return Promise.resolve(response(watch()));
    }
    if (url.origin === apiBase && method === 'POST' &&
        new RegExp(`^/api/v1/ott/${slug}/nodes/(intro|ending)/playback-session$`).test(url.pathname)) {
      assert.equal(options.credentials, 'include'); assert.equal(options.cache, 'no-store');
      assert.equal(options.body, undefined);
      return Promise.resolve(response({ playback: { path: url.pathname.replace(/\/playback-session$/, '/delivery'),
        expiresAt: new Date(Date.now() + 60000).toISOString(), mode: 'secure_http_only_cookie' } }));
    }
    unexpected.push({ method, path: call.path });
    return Promise.reject(new Error('UNEXPECTED_SYNTHETIC_OTT_ROUTE'));
  };
  const context = { document, window, location, navigator: { language: 'ko', maxTouchPoints: 0 }, screen: {},
    localStorage: { getItem: () => null }, API_BASE: apiBase, URL, URLSearchParams, AbortController, Blob,
    fetch: transport,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    getAuth() { throw new Error('UNEXPECTED_AUTH_READ'); },
    refreshAuthOnce() { throw new Error('UNEXPECTED_AUTH_RETRY'); }
  };
  runInNewContext(`${apiSource}\n${source}`, context, { filename: fileURLToPath(sourceUrl), timeout: 2000 });
  t.after(() => timers.clear());
  await flush();
  assert.equal(heads.length, 3, 'full IIFE bootstrap starts the actual three mother HEAD requests');
  assert.deepEqual(heads.map(call => call.path), branchFiles.map(file => motherRoot + file));
  assert.equal(heads.every(call => !call.settled), true);
  if (publicDetail) {
    assert.ok(get('ottStartViewing').listeners.get('click')?.length, 'actual detail response binds the actual watch button');
    assert.equal(get('ottStartViewing').disabled, false);
    assert.equal(get('ottDemoTitle').textContent, '엄마의 선택');
  } else {
    assert.equal(get('ottCatalogRoot').querySelector('.ott-card-art').getAttribute('href'), `/ott?title=${slug}`);
  }
  return { document, get, video, calls, heads, unexpected, timers };
}
function finishHead(record, outcome) {
  assert.equal(record.method, 'HEAD'); assert.equal(record.settled, false);
  record.settled = true;
  if (outcome === 'throw') record.reject(new Error('SYNTHETIC_DEMO_HEAD_FAILED'));
  else record.resolve(response('', Number(outcome), { 'content-type': 'video/mp4', 'content-length': outcome === '200' ? '32' : '0' }));
}
async function keepInitialEmbrace(view) {
  const first = view.heads.slice(0, 3);
  finishHead(first[1], '404'); finishHead(first[2], '404'); await flush();
  assert.equal(first[0].settled, false);
  return first[0];
}
async function click(node) {
  assert.equal(node.disabled, false, 'actual current control must be enabled');
  assert.ok(node.getClientRects().length, 'actual current control must have no hidden ancestor');
  await node.click(); await flush();
}
const delivery = key => `${apiBase}/api/v1/ott/${slug}/nodes/${key}/delivery`;
async function readyPublicNode(view, key) {
  assert.equal(view.video.src, delivery(key), 'actual session response sets the node-specific video source');
  await view.video.fire('loadedmetadata'); await flush();
  assert.equal(view.get('ottDemoTitle').textContent, 'Synthetic public work');
  assert.equal(view.get('ottDemoChoices').hidden, true);
  assert.equal(view.get('ottPublicChoices').hidden, false);
  assert.equal(view.get('ottCaptionDisplay').textContent, `${key} synthetic caption`);
  assert.equal(view.get('ottCaptionDisplay').hidden, false);
}
async function endNode(view) {
  view.video.currentTime = 4.9; view.video.ended = true; view.video.paused = true;
  await view.video.fire('ended'); await flush();
  assert.equal(view.get('ottChoiceOverlay').hidden, false, 'actual ended listener reaches the choice overlay');
}
function assertPublicOverlay(view, key) {
  assert.equal(view.get('ottChoiceOverlay').hidden, false);
  assert.equal(view.get('ottChoiceBack').hidden, false, 'current public exit must remain available');
  assert.equal(view.get('ottNoChoices').hidden, true, 'a demo warning must not appear in public playback');
  assert.equal(view.get('ottDemoChoices').hidden, true);
  assert.equal(view.get('ottDemoChoices').querySelector('[data-ott-branch="embrace"]').hidden, false,
    'hidden demo ancestry does not rewrite child hidden state');
  assert.equal(view.video.src, delivery(key));
  assert.equal(view.get('ottCaptionDisplay').textContent, `${key} synthetic caption`);
  const buttons = view.get('ottPublicChoices').querySelectorAll('button');
  assert.deepEqual(buttons.map(button => button.textContent), key === 'intro' ? ['1Continue to ending'] : []);
  assert.equal(view.get('ottPublicEnding').hidden, key !== 'ending');
  assert.equal(view.get('ottPublicEnding').textContent, key === 'ending' ? 'Synthetic public ending' : '');
}
function snapshot(view) {
  const ids = ['ottChoiceOverlay', 'ottChoiceBack', 'ottNoChoices', 'ottDemoChoices', 'ottPublicChoices',
    'ottPublicEnding', 'ottCaptionDisplay', 'ottPlayerControls', 'ottVideoError', 'ottDemoTitle', 'ottDemoMeta'];
  return {
    elements: Object.fromEntries(ids.map(id => { const node = view.get(id);
      return [id, { text: node.textContent, hidden: node.hidden, visible: Boolean(node.getClientRects().length) }]; })),
    choices: view.get('ottPublicChoices').querySelectorAll('button').map(node => ({ text: node.textContent, disabled: node.disabled })),
    video: { src: view.video.src, position: view.video.currentTime, paused: view.video.paused,
      ended: view.video.ended, loads: view.video.loadCount, crossOrigin: view.video.crossOrigin },
    cc: { hidden: view.get('ottToggleCaptions').hidden, active: view.get('ottToggleCaptions').dataset.active },
    calls: view.calls.map(call => ({ method: call.method, path: call.path }))
  };
}
function assertTransport(view, nodes = []) {
  assert.deepEqual(view.unexpected, []);
  assert.deepEqual(view.calls.filter(call => call.method === 'POST').map(call => call.path),
    nodes.map(key => `/api/v1/ott/${slug}/nodes/${key}/playback-session`));
}
async function startPublic(view, mode) {
  await click(view.get('ottStartViewing')); await readyPublicNode(view, 'intro'); await endNode(view);
  assertPublicOverlay(view, 'intro');
  assert.deepEqual(view.calls.filter(call => call.method === 'GET').map(call => call.path),
    [`/api/v1/ott/${slug}`, `/api/v1/ott/${slug}/watch?locale=ko`]);
  if (mode === 'ending') {
    await click(view.get('ottPublicChoices').querySelector('button'));
    await readyPublicNode(view, 'ending'); await endNode(view); assertPublicOverlay(view, 'ending');
  }
}

const publicCases = ['choices', 'ending'].flatMap(mode => outcomes.map(outcome => ({ mode, outcome,
  name: mode === 'choices' && outcome === '200' ? redName :
    `${prefix}: initial mother HEAD ${outcome} preserves current public ${mode}` })));
const demoCases = outcomes.map(outcome => ({ outcome,
  name: `${prefix}: current demo mother HEAD ${outcome} updates only demo availability` }));
const newerCases = [{ old: '200', current: '404' }, { old: '404', current: '200' }, { old: 'throw', current: '200' }]
  .map(value => ({ ...value, name: `${prefix}: superseded initial mother HEAD ${value.old} cannot overwrite new mother HEAD ${value.current}` }));
export const caseNames = Object.freeze([...publicCases, ...demoCases, ...newerCases].map(value => value.name));

for (const { mode, outcome, name } of publicCases) {
  test(name, async t => {
    const view = await boot(t), old = await keepInitialEmbrace(view);
    await startPublic(view, mode);
    const before = snapshot(view), buttons = view.get('ottPublicChoices').querySelectorAll('button');
    finishHead(old, outcome); await flush();
    assert.equal(view.get('ottChoiceBack').hidden, false, 'late demo HEAD must not hide public choice exit');
    assert.equal(view.get('ottNoChoices').hidden, true, 'late demo HEAD must not show a demo-only warning');
    assert.deepEqual(snapshot(view), before, 'late demo availability must not mutate current public DOM/media/captions or send requests');
    const retainedButtons = view.get('ottPublicChoices').querySelectorAll('button');
    assert.equal(retainedButtons.length, buttons.length);
    buttons.forEach((button, index) => assert.equal(retainedButtons[index], button, 'actual current choice button identity is retained'));
    assertPublicOverlay(view, mode === 'choices' ? 'intro' : 'ending');
    if (mode === 'choices') {
      await click(buttons[0]); await readyPublicNode(view, 'ending'); await endNode(view); assertPublicOverlay(view, 'ending');
    }
    assertTransport(view, ['intro', 'ending']);
  });
}
for (const { outcome, name } of demoCases) {
  test(name, async t => {
    const view = await boot(t, { publicDetail: false });
    for (const record of view.heads.slice()) finishHead(record, '404'); await flush();
    await click(view.get('ottOpenDemo'));
    assert.equal(view.get('ottDemo').hidden, false);
    assert.equal(view.heads.length, 6);
    for (const record of view.heads.slice(3)) finishHead(record, outcome); await flush();
    await endNode(view);
    assert.equal(view.heads.length, 9, 'actual demo ended listener performs its existing availability refresh');
    for (const record of view.heads.slice(6)) finishHead(record, outcome); await flush();
    const buttons = view.get('ottDemoChoices').querySelectorAll('[data-ott-branch]');
    assert.deepEqual(buttons.map(button => button.dataset.ottBranch), branchKeys);
    assert.deepEqual(buttons.map(button => button.disabled), branchKeys.map(() => outcome !== '200'));
    assert.equal(view.get('ottDemoChoices').hidden, false);
    assert.equal(view.get('ottPublicChoices').hidden, true);
    assert.equal(view.get('ottNoChoices').hidden, outcome === '200');
    assert.equal(view.get('ottChoiceBack').hidden, outcome === '200');
    assert.equal(view.video.src, siteBase + motherRoot + '01-common-to-choice.mp4');
    assert.equal(view.get('ottCaptionDisplay').hidden, true, 'synthetic VTT absence is not a subtitle quality result');
    assertTransport(view);
  });
}
for (const { old: outcome, current, name } of newerCases) {
  test(name, async t => {
    const view = await boot(t, { publicDetail: false }), old = await keepInitialEmbrace(view);
    await click(view.get('ottOpenDemo'));
    assert.equal(view.heads.length, 6, 'actual mother selection starts a newer availability request');
    for (const record of view.heads.slice(3)) finishHead(record, current); await flush();
    const buttons = view.get('ottDemoChoices').querySelectorAll('[data-ott-branch]');
    assert.deepEqual(buttons.map(button => button.disabled), branchKeys.map(() => current !== '200'));
    const before = snapshot(view), disabled = buttons.map(button => button.disabled), labels = buttons.map(button => button.textContent);
    finishHead(old, outcome); await flush();
    assert.deepEqual(buttons.map(button => button.disabled), disabled);
    assert.deepEqual(buttons.map(button => button.textContent), labels);
    assert.deepEqual(snapshot(view), before, 'older mother completion cannot overwrite the latest demo result or send requests');
    assert.equal(view.video.src, siteBase + motherRoot + '01-common-to-choice.mp4');
    assertTransport(view);
  });
}

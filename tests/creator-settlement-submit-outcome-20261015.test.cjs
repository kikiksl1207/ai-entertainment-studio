'use strict';
// AUTHOR UNRUN. Parent supplies final source pins; never execute a dirty checkout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const test = require('node:test');
const { htmlWithoutNaverStateAppCacheDelta: cancelCompatOldProjection } = require('./support/feed-search-locale-html-inverse-20261015.cjs');
const cancelCompatFs = require('node:fs');
const cancelCompatPath = require('node:path');
const { createHash: cancelCompatCreateHash } = require('node:crypto');
const { after: cancelCompatAfter } = require('node:test');

const cancelCompatRequire = require;
const cancelCompatSelf = __filename;
function cancelCompatIdentity(raw) {
  return { bytes: raw.length,
    sha256: cancelCompatCreateHash('sha256').update(raw).digest('hex'),
    blob: cancelCompatCreateHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex') };
}
function cancelCompatMatches(raw, expected) {
  const value = cancelCompatIdentity(raw);
  return value.bytes === expected.bytes && value.sha256 === expected.sha256 && value.blob === expected.blob;
}
const cancelCompatHelperProfiles = [
  { bytes: 2382, sha256: '7a181fceda5853dd17dd3fbe604cd32d4098e629428771af5d2ab4cc381984c6',
    blob: '9dfc855aca5dbc50ebdac3e8f6a92b928174c4bc' },
  { bytes: 2435, sha256: 'ae2697cd3411c2b65e50263fd1e1c8ded29234ec2b1598cbd1dd697ecebf4061',
    blob: '7a61ba03a275323a36722fb5094e992d36abf8b7' },
];
const cancelCompatEntryProfiles = [
  { bytes: 62719, sha256: '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a',
    blob: '1a20a15b1f0814d722b97bb1abc12f32411c4e58' },
  { bytes: 63523, sha256: '77123c64ff7c6ce94bf36868fcea6f8d2fa2e2e5451a36a7683aab2e6b5c131d',
    blob: '10286286828722a4e8e6293dd77c75849e316992' },
];
const cancelCompatBeforeProfiles = [
  { bytes: 62703, sha256: '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8',
    blob: '7211a8d47738a397d0453d5708a68e4e3a9682a1' },
  { bytes: 63507, sha256: 'd43cb981b40be46c548cc10a51a3b544281134207400d1c0110b024616447be4',
    blob: 'e58b4deb1d87c84006f6c811c22046e109d5c1c5' },
];
const cancelCompatTracked = new Map();
function cancelCompatRead(file, sizes) {
  const stat = cancelCompatFs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'ordinary cancel compatibility input');
  assert(stat.size > 0 && stat.size <= 128 * 1024, 'cancel input cap before allocation');
  if (sizes) assert(sizes.includes(stat.size), 'exact cancel input size before allocation');
  assert.equal(cancelCompatFs.realpathSync.native(file).toLowerCase(),
    cancelCompatPath.resolve(file).toLowerCase(), 'no cancel input path redirection');
  const raw = cancelCompatFs.readFileSync(file);
  assert.equal(raw.length, stat.size, 'cancel input length remains stable');
  return raw;
}
function cancelCompatText(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert(Buffer.from(text, 'utf8').equals(raw), 'cancel input exact UTF8');
  assert.notEqual(text.charCodeAt(0), 0xFEFF, 'cancel input no BOM');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')),
    'cancel input LF or uniform CRLF');
  return { text, lf };
}
function cancelCompatTrack(file, raw, sizes) {
  const previous = cancelCompatTracked.get(file);
  if (previous) assert(raw.equals(previous.raw), 'cancel input unchanged between reads');
  else cancelCompatTracked.set(file, { raw, sizes });
}
const cancelCompatQPath = cancelCompatPath.join(cancelCompatPath.dirname(cancelCompatSelf),
  'support/creator-interaction-cancel-inverse-20261020.cjs');
const cancelCompatQSizes = cancelCompatHelperProfiles.map(row => row.bytes);
const cancelCompatQRaw = cancelCompatRead(cancelCompatQPath, cancelCompatQSizes);
assert(cancelCompatHelperProfiles.some(row => cancelCompatMatches(cancelCompatQRaw, row)),
  'exact whole raw cancel helper before require');
const cancelCompatQView = cancelCompatText(cancelCompatQRaw);
assert(cancelCompatMatches(Buffer.from(cancelCompatQView.lf, 'utf8'), cancelCompatHelperProfiles[0]),
  'exact whole canonical cancel helper');
cancelCompatTrack(cancelCompatQPath, cancelCompatQRaw, cancelCompatQSizes);
cancelCompatTrack(cancelCompatSelf, cancelCompatRead(cancelCompatSelf), undefined);
cancelCompatAfter(() => {
  const errors = [];
  for (const [file, row] of cancelCompatTracked) {
    try {
      const closing = cancelCompatRead(file, row.sizes);
      assert(closing.equals(row.raw), 'closing cancel compatibility raw bytes');
      assert.deepEqual(cancelCompatIdentity(closing), cancelCompatIdentity(row.raw),
        'closing cancel compatibility length/SHA/blob');
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'All cancel compatibility closing inputs attempted');
});
const cancelCompatQModule = cancelCompatRequire(cancelCompatQPath);
assert.deepEqual(Object.keys(cancelCompatQModule), ['restoreCreatorInteractionCancelHtml']);
assert.equal(typeof cancelCompatQModule.restoreCreatorInteractionCancelHtml, 'function');
function cancelCompatProjection(text) {
  if (typeof text !== 'string') return cancelCompatOldProjection(text);
  const raw = Buffer.from(text, 'utf8');
  const index = cancelCompatEntryProfiles.findIndex(row => cancelCompatMatches(raw, row));
  if (index === -1) return cancelCompatOldProjection(text);
  const file = cancelCompatPath.join(root, 'creator-studio/index.html');
  const sizes = cancelCompatEntryProfiles.map(row => row.bytes);
  const physical = cancelCompatRead(file, sizes);
  assert(cancelCompatMatches(physical, cancelCompatEntryProfiles[index]),
    'exact physical new entry before historical query view');
  assert(physical.equals(raw), 'projection sees the same physical new entry');
  assert.equal(cancelCompatText(physical).text, text, 'new entry physical text preserved');
  cancelCompatTrack(file, physical, sizes);
  const restored = cancelCompatQModule.restoreCreatorInteractionCancelHtml(text);
  assert.equal(typeof restored, 'string');
  assert(cancelCompatMatches(Buffer.from(restored, 'utf8'), cancelCompatBeforeProfiles[index]),
    'exact old entry after query-only view');
  const before = '/pages/creator-story-interactions.js?v=interactions-20261001';
  const after = '/pages/creator-story-interactions.js?v=interactions-cancel-20261020-6eb98ed7';
  assert.equal(restored.split(before).length, 2, 'one restored interaction query');
  assert.equal(restored.replace(before, after), text, 'whole query view forward');
  return cancelCompatOldProjection(restored);
}
const htmlWithoutNaverStateAppCacheDelta = cancelCompatProjection;
const root = path.resolve(process.env.SETTLEMENT_SUBMIT_SOURCE_ROOT || path.join(__dirname, '..'));
const profile = process.env.SETTLEMENT_SUBMIT_PROFILE || 'current';
assert(['baseline', 'current'].includes(profile));
assert(!/[\\/]story-completion-20261003(?:[\\/]|$)/i.test(fs.realpathSync.native(root)));
const oldPins = ['0380465fa757466b97a14808c5fb8b9f9c31cee0b7076efcf1215296c8533fcf',
  '9adbf061676c9869b798e55031edd8d5ae32b8147b6ece27f8caba11c5eba50f'];
const currentPins = ['a59a6e729b92f7795ad085d4e61afaca2fcafaf64f10d26b4e63d17369ba12f6',
  '592d4c36d3f7503759d1c3e910c00054efb9027461f5e61ff9f7e0c0db34277a'];
const overrides = [process.env.SETTLEMENT_SUBMIT_JS_SHA, process.env.SETTLEMENT_SUBMIT_HTML_SHA];
if (overrides.some(value => value !== undefined)) assert(overrides.every(value => typeof value === 'string'), 'Explicit pair, never half an override');
const pins = profile === 'baseline' ? oldPins : overrides.every(value => value !== undefined) ? overrides : currentPins;
for (const pin of pins) assert.match(pin || '', /^[a-f0-9]{64}$/, 'Explicit frozen product pins required');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function source(file, expected) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert(bytes.length > 0 && bytes.length <= 1024 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'));
  let lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'));
  assert(text === lf || text === lf.replace(/\n/g, '\r\n'), 'Uniform checkout line endings required');
  if (file === 'creator-studio/index.html' && sha(lf) !== expected) lf = htmlWithoutNaverStateAppCacheDelta(text).replace(/\r\n/g, '\n');
  assert.equal(sha(lf), expected, 'Exact LF source or uniform checkout CRLF required');
  return lf;
}
const script = source('pages/creator-studio.js', pins[0]);
const html = source('creator-studio/index.html', pins[1]);
for (const id of ['studioShell', 'studioAccessGate', 'settlement', 'studioModal', 'studioModalSummary',
  'studioModalConfirm', 'studioModalClose', 'studioModalCancel', 'studioSettlementConversionRows']) {
  assert.equal(html.split('id="' + id + '"').length, 2, 'Actual HTML uniquely admits fixture target');
}
const seam = '  verify();\n})();';
const replacement = '  window.__settlementSubmitQA = { verify, open: openSettlementConversionModal };\n})();';
assert.equal(script.split(seam).length, 2, 'Unique existing end seam');
const whole = script.replace(seam, replacement);
assert.equal(whole.replace(replacement, seam), script, 'Whole-source seam inverse');
const ENDPOINT = '/api/v1/me/creator-studio/settlement-conversions';
const EPOCH = Date.parse('2026-10-15T03:00:00Z');
const AUTH = n => ({ accessToken: 'synthetic-access-' + n, user: { id: 'synthetic-owner-' + n } });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }
function response(value, status = 200, options = {}) {
  const text = options.text === undefined ? JSON.stringify(value) : options.text;
  const bytes = new TextEncoder().encode(text);
  const stats = { reads: 0, cancelled: 0, released: 0 };
  let sent = false;
  const body = async () => { stats.reads++; if (options.wait) await options.wait.promise; if (options.failure) throw new Error('SYNTHETIC_BODY_FAILURE'); return text; };
  const cancel = async () => { stats.cancelled++; if (options.cancelReject) throw new Error('SYNTHETIC_CANCEL_REJECTION'); };
  return { ok: status >= 200 && status < 300, status, stats,
    headers: { get: name => ({ 'content-type': 'application/json; charset=utf-8', 'content-length': String(bytes.length) })[name.toLowerCase()] || null },
    json: async () => JSON.parse(await body()), text: body,
    arrayBuffer: async () => new TextEncoder().encode(await body()).buffer,
    body: { cancel, getReader() { return {
      async read() { if (sent) return { done: true }; sent = true; await body(); return { done: false, value: bytes }; },
      cancel, releaseLock() { stats.released++; },
    }; } },
  };
}
function ack(intent, status = 'requested', patch = {}) {
  return { conversion: { id: '11111111-1111-4111-8111-111111111111', settlementKey: intent.settlementKey,
    amountKrw: intent.amountKrw + '.000', note: intent.note || null, status, ...patch }, idempotentReplay: true, policy: {} };
}
function filterError(status, code) {
  return { success: false, error: { code, message: code === 'SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW'
    ? 'Requested amount exceeds the current settlement preview balance' : 'Synthetic bounded rejection', statusCode: status,
    path: ENDPOINT, timestamp: '2026-10-15T03:00:00.000Z' } };
}

function fixture() {
  const ids = new Map(), windowEvents = new Map(), docEvents = new Map(), timers = new Map(), calls = [], queue = [];
  let auth = AUTH('a'), timer = 0, now = 0, random = 0, writes = 0, previewEmpty = false;
  let attemptedInvocations = 0, fixtureAdmissionFaults = 0;
  let renderHook = null, renderHits = 0, allowSwap = null, allowSwapHits = 0;
  function rendered(node, property, value) {
    if (renderHook && node.id === 'studioModalConfirm' && property === 'disabled' && value === true) {
      const callback = renderHook; renderHook = null; renderHits++; callback();
    }
  }
  const decode = s => String(s).replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function matches(node, selector) {
    if (!node || !node.tagName) return false;
    const leaf = selector.trim().split(/\s+/).pop();
    if (leaf.startsWith('#')) return node.id === leaf.slice(1);
    const tag = /^([a-z][\w-]*)/i.exec(leaf);
    if (tag && node.tagName !== tag[1].toUpperCase()) return false;
    for (const m of leaf.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(m[1])) return false;
    for (const m of leaf.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
      if (!node.hasAttribute(m[1]) || (m[2] !== undefined && node.getAttribute(m[1]) !== m[2])) return false;
    }
    return true;
  }
  function all(node) { return node.children.flatMap(child => [child, ...all(child)]); }
  function remove(node) { node.children.forEach(remove); if (node.id && ids.get(node.id) === node) ids.delete(node.id); node.parentNode = null; }
  function element(tag = 'div', attrs = {}) {
    const attributes = new Map(), events = new Map(), classes = new Set(); let content = '', value = '', disabled = false;
    const node = { tagName: tag.toUpperCase(), children: [], parentNode: null, dataset: {}, style: {}, hidden: false,
      disabled: false, readOnly: false, checked: false, files: [], defaultValue: '', selectedIndex: 0,
      classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)),
        contains: v => classes.has(v), toggle(v, force) { const yes = force === undefined ? !classes.has(v) : force; if (yes) classes.add(v); else classes.delete(v); return yes; } },
      setAttribute(name, v) { v = String(v); attributes.set(name, v); if (name === 'id') { node.id = v; ids.set(v, node); }
        else if (name === 'class') { classes.clear(); v.split(/\s+/).filter(Boolean).forEach(x => classes.add(x)); }
        else if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        else if (['hidden', 'disabled', 'readonly', 'checked'].includes(name)) node[name === 'readonly' ? 'readOnly' : name] = true;
        else if (name === 'value') { value = v; node.defaultValue = v; } else node[name] = v; },
      getAttribute: name => name === 'class' ? [...classes].join(' ') : attributes.get(name) ?? null,
      hasAttribute: name => attributes.has(name), removeAttribute(name) { attributes.delete(name); if (name === 'disabled') node.disabled = false; if (name === 'hidden') node.hidden = false; },
      addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
      removeEventListener(name, fn) { events.set(name, (events.get(name) || []).filter(x => x !== fn)); },
      dispatchEvent(event) { event.target ||= node; event.currentTarget = node; event.preventDefault ||= () => {};
        for (const fn of [...(events.get(event.type) || [])]) fn(event);
        if (event.bubbles) for (const fn of docEvents.get(event.type) || []) fn(event); return true; },
      click() { if (!node.disabled) node.dispatchEvent({ type: 'click', bubbles: true }); },
      closest(selector) { let current = node; while (current) { if (matches(current, selector)) return current; current = current.parentNode; } return null; },
      contains(other) { return node === other || all(node).includes(other); },
      querySelectorAll(selector) { return all(node).filter(n => selector.split(',').some(s => matches(n, s))); },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
      replaceChildren(...children) { node.children.forEach(remove); node.children = []; content = ''; children.forEach(child => node.appendChild(child)); },
      remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(n => n !== node); remove(node); },
      focus() { document.activeElement = node; }, scrollTo() {}, reset() {}, prepend(child) { child.parentNode = node; node.children.unshift(child); },
    };
    Object.defineProperties(node, {
      disabled: { get: () => disabled, set(v) { disabled = Boolean(v); rendered(node, 'disabled', disabled); } },
      isConnected: { get() { let n = node; while (n.parentNode) n = n.parentNode; return n === tree; } },
      innerHTML: { get: () => content, set(v) { node.children.forEach(remove); node.children = []; content = String(v); parse(content, node); } },
      textContent: { get: () => content.replace(/<[^>]*>/g, '') + node.children.map(n => n.textContent).join(''), set(v) { node.children.forEach(remove); node.children = []; content = String(v); } },
      value: { get() { return node.tagName === 'SELECT' ? (node.options[node.selectedIndex]?.value || '') : value; }, set(v) {
        value = String(v); if (node.tagName === 'SELECT') node.selectedIndex = node.options.findIndex(n => n.value === value); } },
      options: { get: () => all(node).filter(n => n.tagName === 'OPTION') },
      selectedOptions: { get: () => node.options[node.selectedIndex] ? [node.options[node.selectedIndex]] : [] },
    });
    for (const [name, v] of Object.entries(attrs)) node.setAttribute(name, v);
    return node;
  }
  const tree = element('document');
  function parse(text, parent) {
    const stack = [parent];
    for (const match of text.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>/gi)) {
      if (!match[1]) continue;
      const tag = match[1].toLowerCase();
      if (match[0].startsWith('</')) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; } continue; }
      const attrs = {};
      for (const a of match[2].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const child = element(tag, attrs); stack.at(-1).appendChild(child);
      if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) stack.push(child);
    }
  }
  parse(html, tree);
  const document = { body: tree.querySelector('body'), documentElement: tree.querySelector('html'), hidden: false, visibilityState: 'visible',
    getElementById: id => ids.get(id) || null, querySelector: selector => tree.querySelector(selector), querySelectorAll: selector => tree.querySelectorAll(selector),
    createElement: tag => element(tag), addEventListener(name, fn) { if (!docEvents.has(name)) docEvents.set(name, []); docEvents.get(name).push(fn); } };
  const window = { LUMINA_API_BASE: 'https://creator.synthetic.invalid', addEventListener(name, fn) { if (!windowEvents.has(name)) windowEvents.set(name, []); windowEvents.get(name).push(fn); },
    removeEventListener(name, fn) { windowEvents.set(name, (windowEvents.get(name) || []).filter(n => n !== fn)); } };
  const emit = (name, detail = {}) => { for (const fn of [...(windowEvents.get(name) || [])]) fn({ type: name, ...detail }); };
  const e = id => { const node = document.getElementById(id); assert(node, 'Admitted actual control missing: ' + id); return node; };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [EPOCH + now])); } static now() { return EPOCH + now; } }
  const math = Object.create(Math); math.random = () => (++random % 1000) / 1000;
  async function fetch(url, options = {}) {
    attemptedInvocations++;
    let parsed, method, intent, scripted;
    try {
      parsed = new URL(url); assert.equal(parsed.origin, 'https://creator.synthetic.invalid');
      method = options.method || 'GET'; assert.equal(options.headers.Authorization, 'Bearer ' + auth.accessToken);
      assert(calls.length < 48, 'Bounded synthetic request table');
      if (method === 'POST') {
        assert.equal(parsed.pathname, ENDPOINT); assert.equal(parsed.search, ''); assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(typeof options.body, 'string'); intent = JSON.parse(options.body);
        assert.equal(Object.keys(intent).sort().join(','), 'amountKrw,idempotencyKey,note,settlementKey');
        assert.equal(typeof intent.idempotencyKey, 'string'); assert(queue.length, 'Every explicit POST scripted');
        scripted = queue.shift();
      } else {
        assert.equal(method, 'GET'); assert.equal(options.body, undefined);
        assert(['/api/v1/me/creator-studio', '/api/v1/wallet', ENDPOINT, '/api/v1/me/creator-studio/knowledge-urls'].includes(parsed.pathname)
          || parsed.pathname.endsWith('/settlement-preview') || parsed.pathname.endsWith('/payout-summary'), 'No other API route');
      }
      calls.push({ method, route: parsed.pathname, search: parsed.search, body: options.body, owner: auth.user.id });
    } catch (error) {
      fixtureAdmissionFaults++; throw error;
    }
    if (method === 'POST') return await scripted(intent);
    if (parsed.pathname === '/api/v1/me/creator-studio') return response({ viewer: { userId: auth.user.id }, access: { enabled: true }, artists: [], summary: {} });
    if (parsed.pathname === '/api/v1/wallet') return response({ cachedBalance: '0' });
    if (parsed.pathname.endsWith('/settlement-preview')) return response({ totals: { creatorShareKrw: '6000' }, items: previewEmpty ? [] : ['one', 'two'].map(n => ({ settlementKey: 'synthetic-' + n, artist: { displayName: 'Synthetic artist' }, financials: { creatorShareKrw: '6000' } })) });
    if (parsed.pathname.endsWith('/payout-summary')) return response({ totals: {}, fxSnapshot: {} });
    return response({ items: [] });
  }
  const context = { window, document, URL, URLSearchParams, AbortController, DOMException, FormData, Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    Date: ClockDate, Math: math, console: { log() { throw new Error('Unexpected product log'); }, error() { throw new Error('Unexpected product log'); }, warn() { throw new Error('Unexpected product log'); } },
    Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    localStorage: { getItem(key) {
      if (key === 'lumina_auth' && allowSwap && /\bat allow \(/.test(new Error().stack || '')) {
        const next = allowSwap; allowSwap = null; allowSwapHits++; auth = AUTH(next); emit('lumina:authchange');
      }
      return key === 'lumina_auth' ? JSON.stringify(auth) : null;
    }, setItem() { writes++; throw new Error('Storage write'); }, removeItem() { writes++; throw new Error('Storage write'); } },
    sessionStorage: { getItem: () => null, setItem() { writes++; throw new Error('Storage write'); }, removeItem() { writes++; throw new Error('Storage write'); } },
    location: { hash: '#settlement' }, history: { replaceState() {} }, fetch,
    setTimeout(fn, delay) { const id = ++timer; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(whole, context, { filename: 'actual-creator-studio.js', timeout: 2000 });
  const api = window.__settlementSubmitQA; assert.equal(Object.keys(api).sort().join(','), 'open,verify');
  const posts = () => calls.filter(c => c.method === 'POST');
  const reads = () => calls.filter(c => c.method === 'GET' && c.route === ENDPOINT).length;
  const snap = () => ({ modalHidden: e('studioModal').classList.contains('is-hidden'), confirm: e('studioModalConfirm').textContent,
    disabled: e('studioModalConfirm').disabled, summary: e('studioModalSummary').innerHTML, toast: e('studioToast').textContent,
    form: ['studioConversionSettlement', 'studioConversionAmount', 'studioConversionNote'].map(id => document.getElementById(id)?.value ?? null) });
  return { e, calls, posts, reads, snap, emit, attempts: () => attemptedInvocations,
    next(fn) { queue.push(fn); }, async boot() { await api.verify(); await flush(); assert.equal(e('studioShell').hidden, false); },
    async verifyOnly() { await api.verify(); await flush(); },
    onPendingRender(fn) { assert.equal(renderHook, null); renderHook = fn; }, renderHits: () => renderHits,
    swapDuringAllowRead(n) { allowSwap = n; }, allowSwapHits: () => allowSwapHits,
    visibility(value) { document.visibilityState = value; document.hidden = value === 'hidden';
      for (const fn of docEvents.get('visibilitychange') || []) fn({ type: 'visibilitychange' }); },
    open() { api.open(); }, close() { e('studioModalClose').click(); }, confirm() { e('studioModalConfirm').dispatchEvent({ type: 'click', bubbles: true }); now++; },
    nativeOpen() { const button = document.querySelector('[data-action="settlement-conversion"]');
      assert(button, 'Actual native conversion entry exists');
      assert.equal(button.disabled, false, 'Retained unknown intent keeps native entry enabled'); button.click(); },
    form(values = {}) { for (const [id, value] of Object.entries({ studioConversionSettlement: 'synthetic-one', studioConversionAmount: '2000', studioConversionNote: 'Synthetic note', ...values })) e(id).value = value; },
    owner(n) { auth = AUTH(n); const before = calls.length; emit('lumina:authchange'); assert.equal(calls.length, before, 'Owner retirement cannot load'); },
    async tick(ms) { now += ms; for (let n = 0; n < 32; n++) { const ready = [...timers].filter(([, t]) => t.at <= now); if (!ready.length) break;
      for (const [id, t] of ready) { timers.delete(id); t.fn(); } await flush(); } await flush(); },
    noPreview(value = true) { previewEmpty = value; },
    check() { assert.equal(fixtureAdmissionFaults, 0, 'Synthetic fetch admission failed');
      assert.equal(writes, 0); assert.equal(queue.length, 0, 'All scripted POST opportunities consumed'); assert(calls.length < 48); },
    finish() { timers.clear(); assert.equal(fixtureAdmissionFaults, 0, 'Synthetic fetch admission failed'); assert.equal(writes, 0); },
  };
}
async function unknown(f, status = 503) { f.next(() => response({}, status)); f.confirm(); await flush(); }
function sameBody(a, b, marker = 'Frozen intent body changed') { assert.equal(a === b, true, marker); }

const cases = [
  ['SETTLEMENT.SUBMIT.OUTCOME.01 unknown same-intent retry preserves its first key and body', async () => {
    const f = fixture();
    try {
      await f.boot(); f.open(); f.form(); f.next(async () => { throw new Error('SYNTHETIC_DELIVERY_UNKNOWN'); }); f.confirm(); await flush();
      assert.equal(f.posts().length, 1); const first = f.posts()[0].body;
      f.close(); f.open(); f.form({ studioConversionAmount: '2000.0', studioConversionNote: '  Synthetic note  ' });
      await unknown(f); assert.equal(f.posts().length, 2);
      sameBody(f.posts()[1].body, first, 'SETTLEMENT_SUBMIT_UNKNOWN_RETRY_KEY');
      for (const edit of [{ studioConversionSettlement: 'synthetic-two' }, { studioConversionAmount: '3000' }, { studioConversionNote: 'Different synthetic note' }]) {
        f.form(edit); f.confirm(); await flush(); assert.equal(f.posts().length, 2, 'Changed intent cannot discard uncertainty');
      }
      f.close(); f.noPreview(); await f.boot(); f.nativeOpen(); f.form();
      f.next(intent => response(ack(intent, 'credited'))); const readBefore = f.reads(); f.confirm(); await flush();
      assert.equal(f.posts().length, 3); sameBody(f.posts()[2].body, first); assert.equal(f.reads(), readBefore + 1);
      f.close(); f.noPreview(false); await f.boot(); f.open(); f.form(); f.next(intent => response(ack(intent))); f.confirm(); await flush();
      assert.equal(f.posts().length, 4); assert.notEqual(JSON.parse(f.posts()[3].body).idempotencyKey, JSON.parse(first).idempotencyKey);
      f.check();
    } finally { f.finish(); }
  }],
  ['SETTLEMENT.SUBMIT.OUTCOME.02 duplicate flight and retired view cannot submit or repaint', async () => {
    for (const retirement of ['owner', 'view']) {
      const f = fixture(); try {
        await f.boot(); f.open(); f.form(); const before = f.calls.length, attemptedBefore = f.attempts();
        f.onPendingRender(() => retirement === 'owner' ? f.owner('b') : f.close());
        f.confirm(); await flush(); assert.equal(f.renderHits(), 1, 'Observable pending render was reached');
        assert.equal(f.posts().length, 0, 'Retirement during pending render must precede dispatch');
        assert.equal(f.attempts(), attemptedBefore, 'Retirement must precede every fetch invocation');
        assert.equal(f.calls.length, before, 'No automatic recovery read');
        if (retirement === 'view') { f.open(); f.form(); f.next(intent => response(ack(intent))); f.confirm(); await flush();
          assert.equal(f.posts().length, 1, 'A never-dispatched retired view leaves no false pending lock'); }
        f.check();
      } finally { f.finish(); }
    }
    for (const outcome of ['ack', 'failure']) {
      const f = fixture(), late = deferred(); let intent;
      try {
        await f.boot(); f.open(); f.form(); f.next(value => { intent = value; return late.promise; }); f.confirm(); f.confirm(); await flush();
        assert.equal(f.posts().length, 1, 'Function-level flight guard');
        const oldAmount = f.e('studioConversionAmount'); f.close(); f.open(); f.confirm(); await flush(); assert.equal(f.posts().length, 1);
        assert.notEqual(f.e('studioConversionAmount'), oldAmount, 'Actual form replacement has new nodes');
        const before = f.snap(), reads = f.reads(), button = f.e('studioModalConfirm');
        if (outcome === 'ack') late.resolve(response(ack(intent))); else late.reject(new Error('SYNTHETIC_CLOSED_FAILURE'));
        await flush(); assert.deepEqual(f.snap(), before, 'Retired initiating view has no UI authority');
        assert.equal(f.e('studioModalConfirm'), button); assert.equal(f.reads(), reads); f.check();
      } finally { late.resolve(response({})); f.finish(); }
    }
  }],
  ['SETTLEMENT.SUBMIT.OUTCOME.03 owner and page retirement fence late headers body and finally', async () => {
    const latch = fixture(); try {
      latch.swapDuringAllowRead('b'); await latch.verifyOnly(); assert.equal(latch.allowSwapHits(), 1, 'Actual allow auth read reached');
      assert.equal(latch.calls.filter(call => call.route === '/api/v1/me/creator-studio' && call.owner === 'synthetic-owner-b').length, 0);
      latch.open(); latch.confirm(); await flush(); assert.equal(latch.posts().length, 0, 'An A verification cannot latch a new B conversion grant'); latch.check();
    } finally { latch.finish(); }
    for (const phase of ['headers', 'body']) {
      const f = fixture(), old = deferred(), current = deferred(); let a, b;
      try {
        await f.boot(); f.open(); f.form(); f.next(intent => { a = intent; return phase === 'headers' ? old.promise : response(ack(intent), 200, { wait: old, failure: true }); });
        f.confirm(); await flush(); f.owner('b'); await f.boot(); f.open(); f.form({ studioConversionNote: 'Synthetic B note' });
        f.next(intent => { b = intent; return current.promise; }); f.confirm(); await flush(); const before = f.snap(), reads = f.reads();
        old.resolve(phase === 'headers' ? response(ack(a)) : undefined); await flush();
        assert.deepEqual(f.snap(), before); assert.equal(f.reads(), reads); f.confirm(); await flush(); assert.equal(f.posts().length, 2);
        current.resolve(response(ack(b, 'cancelled'))); await flush();
        f.owner('a'); await f.boot(); f.open(); assert.equal(f.e('studioConversionNote').value, '', 'Observed ABA cannot restore old form'); f.check();
      } finally { old.resolve(response({})); current.resolve(response({})); f.finish(); }
    }
    for (const cancelReject of [false, true]) {
      const f = fixture(), late = deferred(); let intent;
      try {
        await f.boot(); f.open(); f.form(); f.next(value => { intent = value; return late.promise; }); f.confirm(); await flush();
        f.emit('pagehide', { persisted: true }); const before = f.calls.length;
        for (const id of ['studioConversionSettlement', 'studioConversionAmount', 'studioConversionNote', 'studioConversionLumina']) assert.equal(f.e(id).value, '', 'Pagehide clears private and derived fields');
        assert.equal(f.e('studioConversionSettlement').options.length, 0); assert(f.e('studioModal').classList.contains('is-hidden'));
        f.emit('pageshow', { persisted: true }); f.open(); f.confirm(); await flush(); assert.equal(f.calls.length, before, 'Permanent page seal: no verify GET or POST');
        const sealed = f.snap(), lateResponse = response(ack(intent), 200, { cancelReject });
        late.resolve(lateResponse); await flush(); assert.equal(lateResponse.stats.reads, 0, 'Retired late headers never read a private body');
        assert(lateResponse.stats.cancelled >= 1, 'Retired late response body cancellation attempted');
        assert.equal(f.calls.length, before); assert.deepEqual(f.snap(), sealed); f.check();
      } finally { late.resolve(response({})); f.finish(); }
    }
    const background = fixture(), headers = deferred(); let returnedIntent;
    try {
      await background.boot(); background.open(); background.form();
      background.next(intent => { returnedIntent = intent; return headers.promise; }); background.confirm(); await flush();
      background.visibility('hidden'); const pending = background.snap(), before = background.calls.length;
      headers.resolve(response(ack(returnedIntent, 'credited'))); await flush();
      assert.deepEqual(background.snap(), pending, 'Background completion has no UI authority'); assert.equal(background.calls.length, before);
      background.visibility('visible'); await flush(); assert.equal(background.calls.length, before, 'Visibility alone cannot load or submit');
      background.open(); assert.equal(background.e('studioModalConfirm').disabled, false, 'Current hidden reply cannot leave a permanent pending lock');
      background.confirm(); await flush(); assert.equal(background.posts().length, 1, 'Explicit acknowledged-receipt confirmation is not another POST');
      assert.equal(background.calls.length, before, 'Reopen/receipt completion do not replay the skipped list read');
      background.open(); background.form(); background.next(intent => response(ack(intent))); background.confirm(); await flush();
      assert.equal(background.posts().length, 2, 'Only a deliberately new confirmed interaction can submit'); background.check();
    } finally { headers.resolve(response({})); background.finish(); }
    const fresh = fixture(); try { await fresh.boot(); assert.equal(fresh.posts().length, 0, 'Fresh document never automatically submits'); fresh.check(); } finally { fresh.finish(); }
  }],
  ['SETTLEMENT.SUBMIT.OUTCOME.04 acknowledgement and conflict preserve prior uncertainty', async () => {
    const amountCode = 'SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW';
    for (const status of ['credited', 'cancelled']) {
      const f = fixture(); try { await f.boot(); f.open(); f.form({ studioConversionNote: '' }); const reads = f.reads();
        f.next(intent => { const value = ack(intent, status, { amountKrw: '0002000.0000', note: status === 'credited' ? null : undefined });
          value.idempotentReplay = status === 'cancelled'; return response(value); });
        f.confirm(); await flush(); assert.equal(f.posts().length, 1); assert.equal(f.reads(), reads + 1, 'Legitimate advanced replay and lossless amount'); f.check();
      } finally { f.finish(); }
    }
    for (const priorUnknown of [false, true]) {
      const f = fixture(); try {
        await f.boot(); f.open(); f.form(); if (priorUnknown) await unknown(f);
        f.next(() => response(filterError(400, amountCode), 400)); f.confirm(); await flush(); const first = f.posts()[0].body, before = f.posts().length;
        f.close(); f.open(); f.form({ studioConversionAmount: '3000' });
        if (!priorUnknown) f.next(intent => response(ack(intent)));
        f.confirm(); await flush(); assert.equal(f.posts().length, before + (priorUnknown ? 0 : 1));
        if (!priorUnknown) assert.notEqual(JSON.parse(f.posts().at(-1).body).idempotencyKey, JSON.parse(first).idempotencyKey);
        else { f.form(); await unknown(f); sameBody(f.posts().at(-1).body, first); } f.check();
      } finally { f.finish(); }
    }
    for (const body of [filterError(409, 'SETTLEMENT_CONVERSION_IDEMPOTENCY_CONFLICT'), {}]) {
      const f = fixture(); try { await f.boot(); f.open(); f.form(); f.next(() => response(body, 409)); f.confirm(); await flush();
        f.close(); f.open(); f.confirm(); await flush(); assert.equal(f.posts().length, 1, 'Every409 holds without another submit'); f.check(); } finally { f.finish(); }
    }
    const invalid = [value => ({ ...value, idempotentReplay: 'true' }), value => ({ ...value, conversion: { ...value.conversion, id: 'not-a-uuid' } }),
      value => ({ ...value, conversion: { ...value.conversion, amountKrw: '2000.0000000000000001' } }),
      value => ({ ...value, conversion: { ...value.conversion, status: 'canceled' } })];
    for (const change of invalid) {
      const f = fixture(); try { await f.boot(); f.open(); f.form(); const reads = f.reads(); f.next(intent => response(change(ack(intent)))); f.confirm(); await flush();
        assert.equal(f.reads(), reads); const first = f.posts()[0].body; await unknown(f); sameBody(f.posts()[1].body, first); f.check(); } finally { f.finish(); }
    }
    for (const kind of ['oversize', 'stall', '401', 'wrong400', 'typed400', 'extra400', 'invalidDate400']) {
      const f = fixture(), wait = deferred(); try { await f.boot(); f.open(); f.form(); const reads = f.reads();
        f.next(intent => kind === '401' ? response(filterError(401, 'UNAUTHORIZED'), 401)
          : kind === 'wrong400' ? response({ success: false, error: { ...filterError(400, amountCode).error, message: 'Other bounded rejection' } }, 400)
          : kind === 'typed400' ? response({ success: false, error: { ...filterError(400, amountCode).error, details: [] } }, 400)
          : kind === 'extra400' ? response({ ...filterError(400, amountCode), unrelated: true }, 400)
          : kind === 'invalidDate400' ? response({ success: false, error: { ...filterError(400, amountCode).error, timestamp: '2026-99-15T03:00:00.000Z' } }, 400)
          : response({ ...ack(intent), padding: kind === 'oversize' ? 'x'.repeat(32768) : '' }, 200, kind === 'stall' ? { wait } : {}));
        f.confirm(); await flush(); if (kind === 'stall') await f.tick(5001);
        assert.equal(f.reads(), reads); const first = f.posts()[0].body; await unknown(f); sameBody(f.posts()[1].body, first); f.check();
      } finally { wait.resolve(); await flush(); f.finish(); }
    }
  }],
];
for (const [name, callback] of cases) test(name, callback);

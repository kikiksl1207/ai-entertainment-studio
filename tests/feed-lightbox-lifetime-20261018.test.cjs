'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { test } = require('node:test');

const bytes = fs.readFileSync(path.join(__dirname, '../app.js'));
assert(bytes.length >= 431019 && bytes.length <= 862038);
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
assert.equal(decoded.startsWith('\uFEFF'), false);
assert.equal(Buffer.from(decoded).equals(bytes), true);
const fullSource = decoded.replace(/\r\n/g, '\n');
assert.equal(fullSource.includes('\r'), false);
assert.equal(decoded === fullSource || decoded === fullSource.replace(/\n/g, '\r\n'), true);
const canonicalBytes = Buffer.from(fullSource);
assert.equal(canonicalBytes.length, 431019);
assert.equal(createHash('sha256').update(canonicalBytes).digest('hex'),
  '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b');
const begin = fullSource.indexOf('let _lightboxEl = null;');
const end = fullSource.indexOf('\n/* ', begin);
assert.equal(begin, 282165);
assert.equal(end, 286827);
assert.equal(fullSource.indexOf('let _lightboxEl = null;', begin + 1), -1);
const source = fullSource.slice(begin, end);
assert.equal(createHash('sha256').update(source).digest('hex'),
  'd32823877e570ec1cd2c653ca9121a16301be045974d23b0f15d85fe272381e2');

function harness(overflow = '') {
  const keyHandlers = new Set();
  class Element {
    constructor() {
      this.style = {}; this.hidden = false; this.listeners = new Map();
      const classes = new Set();
      this.classList = { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle(x, on) { if (on) classes.add(x); else classes.delete(x); } };
      this.nodes = new Map();
    }
    setAttribute() {}
    removeAttribute(name) { if (name === 'hidden') this.hidden = false; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    dispatch(name, event = {}) {
      for (const fn of [...(this.listeners.get(name) || [])]) fn({ target: this, stopPropagation() {}, preventDefault() {}, ...event });
    }
    set innerHTML(value) {
      assert(value.includes('lightbox-img'));
      for (const selector of ['.lightbox-close', '.lightbox-prev', '.lightbox-next', '.lightbox-img',
        '[data-lightbox-error]', '[data-lightbox-counter]']) this.nodes.set(selector, new Element());
      this.nodes.get('[data-lightbox-error]').hidden = true;
    }
    querySelector(selector) { return this.nodes.get(selector) || null; }
  }
  const body = new Element(); body.style.overflow = overflow; body.children = [];
  body.appendChild = element => body.children.push(element);
  const document = {
    body, createElement: () => new Element(),
    addEventListener(name, handler) { assert.equal(name, 'keydown'); keyHandlers.add(handler); },
    removeEventListener(name, handler) { assert.equal(name, 'keydown'); keyHandlers.delete(handler); },
  };
  const context = { document };
  vm.runInNewContext(source + '\nglobalThis.probe = { open: openLightbox, close: closeLightbox, next: navigateLightbox, state: () => _lightboxState };',
    context, { timeout: 1000, filename: 'actual-app-lightbox-span.js' });
  return { ...context.probe, body, keyHandlers,
    overlay: () => body.children[0],
    key(key) { for (const handler of [...keyHandlers]) handler({ key }); },
  };
}
function semantic(value, code) { if (!value) { const error = new Error(code); error.code = code; throw error; } }
const cases = [
  ['ordinary-navigation-zoom-error', () => {
    const h = harness(), images = ['https://example.invalid/a.jpg', 'https://example.invalid/b.jpg'];
    h.open(images, 0);
    assert.equal(h.state().sources, images); assert.equal(h.keyHandlers.size, 1);
    assert.equal(h.body.style.overflow, 'hidden');
    h.key('ArrowLeft'); assert.equal(h.state().index, 1);
    h.key('ArrowRight'); assert.equal(h.state().index, 0);
    const overlay = h.overlay(), image = overlay.querySelector('.lightbox-img');
    image.dispatch('click'); assert.equal(h.state().zoomed, true);
    h.key('ArrowRight'); assert.equal(h.state().zoomed, false); assert.equal(h.state().index, 1);
    image.dispatch('error'); assert.equal(overlay.classList.contains('is-broken'), true);
    h.key('ArrowLeft'); assert.equal(overlay.classList.contains('is-broken'), false);
    assert.equal(overlay.querySelector('[data-lightbox-error]').hidden, true);
    h.key('Escape'); assert.equal(h.keyHandlers.size, 0); assert.equal(h.body.style.overflow, '');
  }],
  ['repeated-open-one-key', () => {
    const h = harness(), images = ['a', 'b', 'c'];
    h.open(images, 0); h.open(images, 0); h.open(images, 0);
    semantic(h.keyHandlers.size === 1, 'LIGHTBOX_DUPLICATE_KEY_HANDLER');
    h.key('ArrowRight'); assert.equal(h.state().index, 1);
    h.close(); assert.equal(h.keyHandlers.size, 0);
    const index = h.state().index; h.key('ArrowRight'); assert.equal(h.state().index, index);
  }],
  ['prior-scroll-restored-once', () => {
    for (const previous of ['clip', 'auto', 'hidden', 'scroll']) {
      const h = harness(previous); h.open(['a'], 0); h.open(['b'], 0); h.close();
      semantic(h.body.style.overflow === previous, 'LIGHTBOX_PRIOR_SCROLL_LOST');
      h.body.style.overflow = 'visible'; h.close();
      assert.equal(h.body.style.overflow, 'visible');
    }
  }],
  ['invalid-empty-no-side-effects', () => {
    const h = harness('clip');
    for (const value of [undefined, null, [], '', {}]) h.open(value, 0);
    assert.equal(h.body.children.length, 0); assert.equal(h.keyHandlers.size, 0);
    assert.equal(h.body.style.overflow, 'clip'); h.close(); assert.equal(h.body.style.overflow, 'clip');
    const active = harness(), images = ['a', 'b']; active.open(images, 1);
    for (const value of [undefined, null, [], '', {}]) active.open(value, 0);
    assert.equal(active.state().sources, images); assert.equal(active.state().index, 1);
    assert.equal(active.body.children.length, 1); assert.equal(active.keyHandlers.size, 1);
    assert.equal(active.body.style.overflow, 'hidden'); active.close(); assert.equal(active.body.style.overflow, '');
  }],
  ['close-and-reopen-one-lifetime', () => {
    const h = harness();
    h.open(['a'], 0); h.close(); h.open(['b', 'c'], 0);
    assert.equal(h.body.children.length, 1); assert.equal(h.keyHandlers.size, 1);
    h.key('ArrowRight'); assert.equal(h.state().index, 1);
    h.key('Escape'); assert.equal(h.keyHandlers.size, 0); assert.equal(h.body.style.overflow, '');
  }],
  ['index-and-single-image-controls', () => {
    const h = harness(); h.open(['a'], 100); assert.equal(h.state().index, 0);
    assert.equal(h.overlay().querySelector('.lightbox-prev').style.display, 'none');
    assert.equal(h.overlay().querySelector('[data-lightbox-counter]').style.display, 'none');
    h.key('ArrowRight'); assert.equal(h.state().index, 0); h.close();
    h.open(['a', 'b'], -3); assert.equal(h.state().index, 0);
    assert.equal(h.overlay().querySelector('.lightbox-next').style.display, '');
    assert.equal(h.overlay().querySelector('[data-lightbox-counter]').textContent, '1 / 2'); h.close();
  }],
];
for (const [name, run] of cases) test('full app lightbox ' + name, run);

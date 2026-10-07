import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function captureBinding(source) {
  const renders = [...source.matchAll(/^function renderCharacterDetail\(\) \{\r?\n[\s\S]*?^\}\r?$/gm)];
  assert.equal(renders.length, 1, 'Extract the one actual renderCharacterDetail function');
  const render = renders[0], marker = '      if (!gallery.dataset.imageFallbackBound) {';
  assert.equal(render[0].split(marker).length, 2, 'Exactly one actual gallery fallback binding');
  const start = render[0].indexOf(marker), remaining = render[0].slice(start);
  const end = /        \}, \{ capture: true \}\);\r?\n      \}/.exec(remaining);
  assert(end, 'The actual capture binding must end at its existing capture option');
  const body = remaining.slice(0, end.index + end[0].length), absolute = render.index + start;
  return { name: 'renderCharacterDetail:gallery-error-capture-binding', body,
    line: source.slice(0, absolute).split('\n').length, sha256: sha256(body), sourceSha256: sha256(source),
    renderSha256: sha256(render[0]) };
}

export class Element {
  constructor(tag = 'div', root = false) {
    this.tagName = tag.toUpperCase(); this.rootConnected = root; this.parentElement = null; this.children = [];
    this.dataset = {}; this.style = {}; this.attributes = new Map(); this.classes = new Set(); this.listeners = new Map();
    this.classList = { add: value => this.classes.add(value), contains: value => this.classes.has(value) };
    this.removals = 0;
  }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this.rootConnected; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
      node.parentElement = this; this.children.push(node);
    }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null; this.rootConnected = false; this.removals++;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())];
  }
  matches(selector) {
    if (selector === '.gallery-slide') return this.classes.has('gallery-slide');
    if (selector === '.gallery-slide img') return this.tagName === 'IMG' && Boolean(this.parentElement?.closest('.gallery-slide'));
    if (selector === '[data-gallery-recovery]') return this.attributes.has('data-gallery-recovery');
    throw new Error('Unsupported focused synthetic selector: ' + selector);
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  addEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.listeners.get(type) || []; listeners.push({ callback, capture }); this.listeners.set(type, listeners);
  }
}

// Only the actual extracted binding executes. Capture propagation and elements are a bounded synthetic DOM.
export function harness(source) {
  const binding = captureBinding(source), gallery = new Element('section', true), events = [];
  const bind = () => runInNewContext(binding.body, { gallery }, { timeout: 1000, filename: 'actual-character-detail-gallery-capture' });
  bind();
  const h = { binding, gallery, events, bind,
    slide({ managed = false, retried = '1', nestedImage = false, nestedMarker = false, parent = gallery } = {}) {
      const slide = new Element(); slide.classList.add('gallery-slide'); slide.setAttribute('data-lightbox', 'fixture-image');
      slide.style.cursor = 'pointer'; parent.append(slide);
      const image = new Element('img');
      if (retried !== undefined) image.dataset.retried = retried;
      let imageParent = slide;
      if (nestedImage) { imageParent = new Element(); slide.append(imageParent); }
      imageParent.append(image);
      let recovery = null;
      if (managed) {
        recovery = new Element('button'); recovery.setAttribute('data-gallery-recovery', '');
        if (nestedMarker) { const wrapper = new Element(); slide.append(wrapper); wrapper.append(recovery); }
        else slide.append(recovery);
      }
      return { slide, image, imageParent, recovery };
    },
    dispatchError(target, { bubbles = false } = {}) {
      assert(target instanceof Element, 'Synthetic DOM dispatch requires an element; malformed targets use rawCallback separately');
      const event = { type: 'error', target, bubbles }, chain = [];
      for (let node = target; node; node = node.parentElement) chain.push(node);
      for (const node of [...chain].reverse()) for (const listener of node.listeners.get('error') || []) {
        if (listener.capture) { events.push({ phase: 'capture', bubbles, target: target.tagName }); listener.callback(event); }
      }
      for (const node of chain) for (const listener of node.listeners.get('error') || []) {
        if (!listener.capture && (node === target || bubbles)) listener.callback(event);
      }
    },
    rawCallback(target) {
      assert.equal(gallery.listeners.get('error').length, 1);
      return gallery.listeners.get('error')[0].callback({ type: 'error', target, bubbles: false });
    },
    snapshot(cell) { return {
      imageAttached: cell.image.isConnected, parentIsOriginal: cell.image.parentElement === cell.imageParent,
      removed: cell.image.removals, unavailable: cell.slide.classList.contains('is-image-unavailable'),
      lightbox: cell.slide.getAttribute('data-lightbox'), cursor: cell.slide.style.cursor,
      recoveryAttached: Boolean(cell.recovery?.isConnected), captureEvents: events.length,
    }; },
  };
  return h;
}

export function directEvidence(metadata) {
  const result = { ...metadata, pid: process.pid, registered: [], completed: [], observations: [],
    allAfterHooksFinished: false, boundary: 'Actual capture-binding source; synthetic DOM/capture path, not a browser or full page.' };
  if (process.env.GALLERY_FALLBACK_RUN_DIR) {
    const directory = path.resolve(process.env.GALLERY_FALLBACK_RUN_DIR);
    assert(/^E:\\/i.test(directory), 'QA direct reports must stay on E');
    process.once('exit', exitCode => {
      writeFileSync(path.join(directory, `direct.${process.pid}.json`), JSON.stringify({ ...result, moduleProcessExitCode: exitCode }, null, 2) + '\n', { flag: 'wx' });
    });
  }
  return result;
}

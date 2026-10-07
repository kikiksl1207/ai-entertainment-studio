import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];
const existingKeys = ['detail.gallery.photo', 'detail.gallery.official', 'detail.gallery.previous', 'detail.gallery.next'];
const plain = value => JSON.parse(JSON.stringify(value));
const baseUri = 'https://gallery-fixture.invalid/artist?view=gallery';

function functionSource(name) {
  const matches = [...source.matchAll(new RegExp(`^function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `Extract only the actual ${name} function`);
  return matches[0][0];
}

const galleryRows = [...source.matchAll(/^  "(detail\.gallery\.[^"]+)":\s*(\{[^\r\n]*\}|\{\r?\n[\s\S]*?^  \}),?\r?$/gm)];
const dictionary = plain(runInNewContext(`({${galleryRows.map(row => `${JSON.stringify(row[1])}: ${row[2]}`).join(',')}})`,
  {}, { timeout: 1000 }));
const recoveryKeys = Object.keys(dictionary).filter(key => !existingKeys.includes(key));
const sliderSource = functionSource('initGallerySlider');
const aliases = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-Hant' };
const originalLabels = {
  'detail.gallery.photo': ['\ud3ec\ud1a0 \uac24\ub7ec\ub9ac', 'Photo Gallery', '\u30d5\u30a9\u30c8\u30ae\u30e3\u30e9\u30ea\u30fc', '\u7167\u7247\u753b\u5eca', '\u7167\u7247\u85dd\u5eca'],
  'detail.gallery.official': ['\uacf5\uc2dd \uc774\ubbf8\uc9c0', 'Official Images', '\u516c\u5f0f\u753b\u50cf', '\u5b98\u65b9\u56fe\u7247', '\u5b98\u65b9\u5716\u7247'],
  'detail.gallery.previous': ['\uc774\uc804', 'Previous', '\u524d\u3078', '\u4e0a\u4e00\u5f20', '\u4e0a\u4e00\u5f35'],
  'detail.gallery.next': ['\ub2e4\uc74c', 'Next', '\u6b21\u3078', '\u4e0b\u4e00\u5f20', '\u4e0b\u4e00\u5f35'],
};

function style() {
  const values = {};
  Object.defineProperty(values, 'cssText', {
    get: () => Object.entries(values).map(([key, value]) => `${key}:${value}`).join(';'),
    set: text => {
      for (const key of Object.keys(values)) delete values[key];
      for (const part of String(text).split(';')) {
        const index = part.indexOf(':');
        if (index < 0) continue;
        const key = part.slice(0, index).trim().replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        values[key] = part.slice(index + 1).trim();
      }
    },
  });
  return values;
}

function dom() {
  const created = [], listeners = new Map(), scrolls = [], delegatedLightbox = [];
  let body;
  const element = tag => {
    const attrs = new Map(), callbacks = new Map(), classes = new Set();
    const node = { tagName: tag.toUpperCase(), nodeType: 1, children: [], parentElement: null,
      dataset: {}, style: style(), hidden: false, disabled: false, textContent: '',
      complete: false, naturalWidth: 0, naturalHeight: 0, scrollLeft: 0, offsetWidth: 320,
      assignments: [],
      get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); },
      setAttribute(key, value) {
        attrs.set(key, String(value));
        if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
        if (key === 'hidden') this.hidden = true;
        if (key === 'disabled') this.disabled = true;
        if (key === 'src') this.src = value;
      },
      getAttribute: key => attrs.get(key) ?? null,
      hasAttribute: key => attrs.has(key),
      removeAttribute(key) {
        attrs.delete(key);
        if (key === 'hidden') this.hidden = false;
        if (key === 'disabled') this.disabled = false;
        if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())];
      },
      appendChild(child) {
        child.remove(); child.parentElement = this; this.children.push(child); return child;
      },
      append(...children) { for (const child of children) this.appendChild(child); },
      remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        this.parentElement = null;
      },
      contains(other) { return other === this || this.children.some(child => child.contains(other)); },
      matches(selector) {
        return selector.split(',').some(part => {
          part = part.trim();
          if (part.startsWith('.')) return classes.has(part.slice(1));
          const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
          if (attribute) {
            const value = attribute[1].startsWith('data-')
              ? this.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())]
              : attrs.get(attribute[1]);
            return value !== undefined && (attribute[2] === undefined || value === attribute[2]);
          }
          return part.toUpperCase() === this.tagName;
        });
      },
      closest(selector) {
        for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
        return null;
      },
      querySelectorAll(selector) {
        const found = [];
        const visit = parent => { for (const child of parent.children) {
          if (child.matches(selector)) found.push(child); visit(child);
        } };
        visit(this); return found;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      addEventListener(type, callback, options = {}) {
        if (options.signal?.aborted) return;
        const entries = callbacks.get(type) || [];
        entries.push({ callback, options }); callbacks.set(type, entries);
        // Dispatch ignores aborted bindings; real AbortController supplies the signal state.
        listeners.set(this, callbacks);
      },
      removeEventListener(type, callback) {
        callbacks.set(type, (callbacks.get(type) || []).filter(entry => entry.callback !== callback));
      },
      dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        this[`on${event.type}`]?.call(this, event);
        for (const { callback, options } of [...(callbacks.get(event.type) || [])]) {
          if (options.signal?.aborted) continue;
          callback.call(this, event);
          if (options.once) this.removeEventListener(event.type, callback);
        }
        if (event.bubbles && !event.stopped) this.parentElement?.dispatchEvent(event);
        return !event.defaultPrevented;
      },
      emit(type, additions = {}) {
        const event = { type, target: this, bubbles: type === 'click', stopped: false,
          defaultPrevented: false, stopCalls: 0,
          stopPropagation() { this.stopped = true; ++this.stopCalls; },
          preventDefault() { this.defaultPrevented = true; }, ...additions };
        this.dispatchEvent(event); return event;
      },
      click() { if (!this.disabled) return this.emit('click'); },
      scrollBy(options) {
        scrolls.push(options);
        this.scrollLeft = Math.max(0, Math.min(this.scrollLeft + options.left,
          Math.max(0, track.children.length - 1) * this.offsetWidth));
        this.emit('scroll');
      },
      classList: { add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    };
    let rawSrc = '';
    Object.defineProperties(node, {
      className: { get: () => [...classes].join(' '), set: value => {
        classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name));
      } },
      src: { get: () => {
        if (!rawSrc) return '';
        try { return new URL(rawSrc, baseUri).href; } catch { return rawSrc; }
      }, set: value => {
        rawSrc = String(value); attrs.set('src', rawSrc); node.assignments.push(rawSrc);
      } },
      currentSrc: { get: () => node.src },
      innerHTML: { get: () => '', set: value => {
        assert.equal(value, '', 'This scaffold models explicit nodes, not HTML injection');
        for (const child of [...node.children]) child.remove();
      } },
    });
    created.push(node); return node;
  };
  body = element('body');
  const slider = element('div'), track = element('div'), counter = element('span');
  const previous = element('button'), next = element('button');
  body.append(slider, counter, previous, next); slider.appendChild(track);
  const ids = { gallerySlider: slider, galleryTrack: track, galleryCounter: counter, galleryPrev: previous, galleryNext: next };
  body.addEventListener('click', event => {
    const cell = event.target.closest('[data-lightbox]');
    if (cell) delegatedLightbox.push(cell.dataset.lightbox);
  });
  const document = { baseURI: baseUri, body, createElement: element, getElementById: id => ids[id] || null };
  return { document, slider, track, counter, previous, next, created, listeners, scrolls, delegatedLightbox };
}

const items = (count = 5) => Array.from({ length: count }, (_, index) =>
  ({ src: `/approved-fixture/gallery-${index + 1}.webp`, caption: `Synthetic approved photo ${index + 1}` }));

function fixture({ locale = 'en-US', gallery = items(), translate = true } = {}) {
  const host = dom();
  let clock = 1800000000000;
  class FixtureDate extends Date { static now() { return ++clock; } }
  const noActivity = () => assert.fail('This isolated gallery must not start network, timers or another workflow');
  const window = { location: { href: baseUri, origin: new URL(baseUri).origin },
    addEventListener: noActivity, fetch: noActivity };
  const context = { document: host.document, window, location: window.location, URL, AbortController,
    Date: FixtureDate, fetch: noActivity, setTimeout: noActivity, setInterval: noActivity,
    requestAnimationFrame: noActivity, console,
  };
  runInNewContext(`const I18N_LOCALES = ${JSON.stringify(locales)};
    const I18N_FALLBACK = "ko-KR";
    const I18N_LOCALE_ALIASES = ${JSON.stringify(aliases)};
    const I18N_DICT = ${JSON.stringify(dictionary)};
    let _currentLocale = ${JSON.stringify(locale)};
    ${functionSource('normalizeLocale')}
    ${translate ? functionSource('t') : ''}
    let gallerySliderEvents = null;
    ${sliderSource}
    globalThis.galleryTest = { initGallerySlider, events: () => gallerySliderEvents };`, context, { timeout: 1000 });
  const api = context.galleryTest;
  const before = plain(gallery);
  api.initGallerySlider(gallery, 'Synthetic artist');
  return { ...host, api, gallery, before, context,
    images: () => host.track.querySelectorAll('img'), cells: () => host.track.querySelectorAll('[data-lightbox]'),
    reinit: replacement => api.initGallerySlider(replacement, 'Synthetic replacement artist') };
}

function ui(cell) {
  const recovery = cell.querySelector('[data-gallery-recovery]');
  assert.ok(recovery, 'Each gallery cell has its own recovery surface');
  const retry = recovery.querySelector('[data-gallery-image-retry]');
  assert.ok(retry, 'Recovery exposes the explicit retry control');
  const status = recovery.querySelector('[role="status"]');
  assert.ok(status, 'Recovery has an accessible localized status');
  const zoom = cell.children.find(child => child.tagName === 'SPAN');
  assert.ok(zoom, 'Existing gallery zoom affordance remains present');
  return { recovery, retry, status, zoom };
}

function hidden(node) {
  for (let current = node; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || current.style.display === 'none') return true;
  }
  return false;
}

function terminal(f, index = 0) {
  const image = f.images()[index];
  image.emit('error'); image.emit('error');
  return { image, ...ui(f.cells()[index]) };
}

function freshBareUrl(original, retried) {
  const before = new URL(original, baseUri), after = new URL(retried, baseUri);
  assert.ok(['http:', 'https:'].includes(after.protocol));
  assert.equal(before.origin, new URL(baseUri).origin);
  assert.equal(before.search, '', 'Only an unqueried same-origin URL may receive a retry parameter');
  for (const key of ['protocol', 'origin', 'pathname', 'hash', 'username', 'password']) assert.equal(after[key], before[key], key);
  assert.deepEqual([...after.searchParams.keys()], ['retry']);
  assert.match(after.searchParams.get('retry'), /^\d+$/);
  assert.notEqual(after.href, before.href, 'Retry adds a fresh query rather than replacing approved media');
}

console.log('Gallery function/localization extraction and synthetic DOM events only; no browser, layout, actual image loading, HTTP, auth, DB, provider or operating evidence.');

test('normal load retains the approved image with initially hidden recovery', () => {
  const f = fixture(), image = f.images()[0], { recovery } = ui(f.cells()[0]);
  assert.ok(hidden(recovery));
  image.emit('load');
  assert.ok(hidden(recovery)); assert.equal(image.assignments.length, 1);
  assert.equal(image.getAttribute('src'), f.before[0].src);
});

test('first error performs one bounded bare-URL retry with its query before the fragment', () => {
  const approved = '/approved-fixture/gallery-1.webp#approved-frame';
  const f = fixture({ gallery: [{ src: approved, caption: 'Synthetic approved fragment' }] });
  const image = f.images()[0]; image.emit('error');
  assert.equal(image.assignments.length, 2);
  assert.equal(image.dataset.retried, '1');
  freshBareUrl(approved, image.src);
  assert.match(image.getAttribute('src'), /\?retry=\d+#approved-frame$/);
  assert.ok(hidden(ui(f.cells()[0]).recovery));
});

test('second error shows localized status and a 44px icon retry without another assignment', () => {
  const f = fixture(), { image, recovery, retry, status, zoom } = terminal(f);
  assert.equal(image.assignments.length, 2); assert.equal(hidden(recovery), false);
  assert.equal(recovery.style.display, 'flex');
  assert.equal(status.textContent, dictionary['detail.gallery.error']['en-US']);
  assert.equal(retry.getAttribute('aria-label'), dictionary['detail.gallery.retry']['en-US']);
  assert.equal(retry.title, retry.getAttribute('aria-label'));
  assert.equal(image.style.visibility, 'hidden'); assert.equal(zoom.style.visibility, 'hidden');
  assert.equal(retry.disabled, false);
  assert.equal(retry.textContent.trim(), '\u21bb');
  assert.equal(retry.style.width, '44px'); assert.equal(retry.style.height, '44px');
  assert.equal(retry.type || retry.getAttribute('type'), 'button');
});

test('any existing query, including same-origin opaque parameters and external signatures, is unchanged', () => {
  const sources = [
    '/approved-fixture/published.webp?opaque=A%2BB&opaque=C#approved-frame',
    'https://gallery-fixture.invalid/approved.webp?retry=existing&unknown=synthetic#photo',
    'https://cdn-fixture.invalid/approved.webp?Signature=synthetic%2Bsignature&Expires=1900000000#approved-frame',
  ];
  for (const approved of sources) {
    const f = fixture({ gallery: [{ src: approved, caption: 'Synthetic queried image' }] });
    const { image, retry } = terminal(f);
    assert.equal(image.getAttribute('src'), approved);
    retry.click(); image.emit('error'); image.emit('error');
    assert.deepEqual(image.assignments, [approved, approved, approved]);
    assert.equal(f.images().length, 1);
  }
});

test('only same-origin HTTP(S) bare URLs change; external and different-protocol origins stay exact', () => {
  for (const approved of [
    'https://gallery-fixture.invalid/approved.webp#photo',
    'http://gallery-fixture.invalid/approved.webp#photo',
    'https://media-fixture.invalid/approved.webp#photo',
  ]) {
    const f = fixture({ gallery: [{ src: approved, caption: 'Synthetic approved URL' }] });
    const { image } = terminal(f);
    if (new URL(approved).origin === new URL(baseUri).origin) freshBareUrl(approved, image.src);
    else assert.deepEqual(image.assignments, [approved, approved]);
    assert.equal(f.created.filter(node => node.tagName === 'IMG').length, 1);
  }
});

test('data and malformed URL failures preserve their source without unsafe additions or fallback images', () => {
  for (const approved of ['data:image/webp;base64,U1lOVEhFVElD', 'http://[invalid']) {
    const f = fixture({ gallery: [{ src: approved, caption: 'Synthetic invalid source' }] });
    const { image, retry } = terminal(f); retry.click(); image.emit('error');
    assert.deepEqual(image.assignments, [approved, approved, approved]);
    assert.equal(image.getAttribute('src'), approved);
    assert.equal(f.images().length, 1); assert.equal(f.created.filter(node => node.tagName === 'IMG').length, 1);
  }
});

test('explicit retry stops propagation and changes only the chosen image, not the lightbox or count', () => {
  const f = fixture(), { image, retry, recovery, status } = terminal(f, 1);
  const untouched = f.images().filter(img => img !== image).map(img => [...img.assignments]);
  const counter = f.counter.textContent, event = retry.click();
  assert.ok(event.stopCalls > 0); assert.equal(f.delegatedLightbox.length, 0);
  assert.equal(image.assignments.length, 3); assert.equal(hidden(recovery), false);
  assert.equal(status.textContent, dictionary['detail.gallery.loading']['en-US']);
  assert.equal(retry.disabled, true); assert.equal(image.dataset.retried, '1');
  retry.click(); retry.emit('click'); assert.equal(image.assignments.length, 3, 'Pending duplicate activation is ignored');
  freshBareUrl(f.before[1].src, image.src);
  assert.deepEqual(f.images().filter(img => img !== image).map(img => img.assignments), untouched);
  assert.equal(f.counter.textContent, counter);
  f.cells()[1].click(); assert.deepEqual(f.delegatedLightbox, ['1'], 'Delegation probe is active for ordinary cell clicks');
});

test('successful recovery load clears the error state without selecting other media', () => {
  const f = fixture(), { image, recovery, retry, zoom } = terminal(f);
  retry.click(); image.emit('load');
  assert.ok(hidden(recovery)); assert.equal(image.assignments.length, 3);
  assert.equal(image.style.visibility, 'visible'); assert.equal(zoom.style.visibility, 'visible');
  assert.equal(retry.disabled, false); assert.equal(image.dataset.retried, '1');
  assert.deepEqual(f.gallery, f.before); assert.equal(f.images().length, f.before.length);
});

test('repeated terminal error events cannot start an automatic loop', () => {
  const f = fixture(), { image, recovery } = terminal(f);
  for (let index = 0; index < 12; ++index) image.emit('error');
  assert.equal(image.assignments.length, 2); assert.equal(hidden(recovery), false);
  assert.equal(f.images().length, f.before.length);
});

test('each explicit bare-URL retry is fresh but later errors remain terminal without automatic repeats', () => {
  const f = fixture(), { image, retry, recovery, status } = terminal(f);
  const urls = new Set([image.src]);
  for (let index = 0; index < 3; ++index) {
    retry.click(); assert.equal(hidden(recovery), false); assert.equal(retry.disabled, true);
    assert.equal(status.textContent, dictionary['detail.gallery.loading']['en-US']);
    assert.equal(image.dataset.retried, '1');
    assert.equal(image.assignments.length, 3 + index);
    assert.equal(urls.has(image.src), false); urls.add(image.src);
    image.emit('error'); image.emit('error');
    assert.equal(image.assignments.length, 3 + index); assert.equal(hidden(recovery), false);
    assert.equal(retry.disabled, false); assert.equal(status.textContent, dictionary['detail.gallery.error']['en-US']);
  }
});

test('reinitialization aborts old bindings and stale image/retry events cannot affect current cells', () => {
  const f = fixture(), oldImage = f.images()[0], oldUi = ui(f.cells()[0]), oldEvents = f.api.events();
  const oldAssignments = [...oldImage.assignments];
  f.reinit(items(3)); assert.equal(oldEvents.signal.aborted, true);
  assert.equal(oldImage.isConnected, false);
  const current = f.images().map(image => [...image.assignments]), counter = f.counter.textContent;
  oldImage.emit('error'); oldImage.emit('load'); oldUi.retry.click();
  assert.deepEqual(f.images().map(image => image.assignments), current);
  assert.deepEqual(oldImage.assignments, oldAssignments, 'Detached callbacks do not issue stale image retries');
  assert.equal(f.counter.textContent, counter);
  assert.equal(oldUi.recovery.style.display, 'none');
  const detachedImage = f.images()[0], detachedUi = ui(f.cells()[0]);
  f.cells()[0].remove();
  assert.equal(f.api.events().signal.aborted, false, 'Disconnect guard is independent of abort');
  detachedImage.emit('error'); detachedImage.emit('load'); detachedUi.retry.click();
  assert.equal(detachedImage.assignments.length, 1); assert.equal(detachedUi.recovery.style.display, 'none');
  for (const cell of f.cells()) assert.ok(hidden(ui(cell).recovery));
});

test('failure recovery preserves approved inventory, eager/lazy split, page count and single nav bindings', () => {
  const f = fixture({ gallery: items(8) });
  assert.equal(f.track.children.length, 2); assert.equal(f.counter.textContent, '1\u20134 / 8');
  assert.deepEqual(f.images().map(image => image.loading), ['eager', 'eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy', 'lazy']);
  assert.deepEqual(f.images().map(image => image.alt), f.before.map(item => item.caption));
  assert.deepEqual(f.cells().map(cell => cell.dataset.lightbox), ['0', '1', '2', '3', '4', '5', '6', '7']);
  terminal(f); assert.deepEqual(f.gallery, f.before);
  assert.equal(f.images().length, 8); assert.equal(f.track.children.length, 2);
  f.reinit(items(8)); f.next.click();
  assert.equal(f.scrolls.length, 1); assert.equal(f.counter.textContent, '5\u20138 / 8');
  f.previous.click(); assert.equal(f.scrolls.length, 2); assert.equal(f.counter.textContent, '1\u20134 / 8');
  assert.equal(f.previous.disabled, true); assert.equal(f.next.disabled, false);
});

for (const locale of locales) test(`${locale}: error, retry aria/title and pending status use actual localized dictionary labels`, () => {
  assert.deepEqual([...recoveryKeys].sort(), ['detail.gallery.error', 'detail.gallery.loading', 'detail.gallery.retry']);
  for (const key of recoveryKeys) {
    assert.equal(typeof dictionary[key][locale], 'string'); assert.ok(dictionary[key][locale].trim());
  }
  for (const key of existingKeys) assert.equal(dictionary[key][locale], originalLabels[key][locales.indexOf(locale)]);
  const f = fixture({ locale }), { image, status, retry } = terminal(f);
  assert.equal(status.textContent, dictionary['detail.gallery.error'][locale]);
  assert.equal(retry.getAttribute('aria-label'), dictionary['detail.gallery.retry'][locale]);
  assert.equal(retry.title, dictionary['detail.gallery.retry'][locale]);
  assert.notEqual(status.textContent, retry.getAttribute('aria-label'));
  assert.equal(hidden(ui(f.cells()[0]).recovery), false);
  retry.click(); assert.equal(status.textContent, dictionary['detail.gallery.loading'][locale]);
  assert.equal(retry.disabled, true);
  image.emit('error'); assert.equal(status.textContent, dictionary['detail.gallery.error'][locale]);
  assert.equal(retry.disabled, false);
});

test('isolated callers without t retain English fallback labels and keep the URL helper local', () => {
  const f = fixture({ translate: false }), { image, status, retry, recovery } = terminal(f);
  assert.equal(typeof f.context.t, 'undefined'); assert.equal(typeof f.context.retryImageUrl, 'undefined');
  assert.equal(status.textContent, 'Image could not be loaded.');
  assert.equal(retry.title, 'Retry image'); assert.equal(retry.getAttribute('aria-label'), 'Retry image');
  retry.click(); assert.equal(status.textContent, 'Loading\u2026');
  assert.equal(retry.disabled, true); assert.equal(image.assignments.length, 3);
  image.emit('load'); assert.ok(hidden(recovery)); assert.equal(retry.disabled, false);
});

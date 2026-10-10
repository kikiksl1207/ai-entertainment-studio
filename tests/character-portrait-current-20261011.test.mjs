import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// QA-only synthetic DOM: execute only the actual portrait function, not page boot.
// A parent may select preserved original bytes and filter [baseline-race] tests.
// Those tests keep zero-mutation assertions: an original failure is RED, not PASS.
const sourceFile = process.env.CHARACTER_PORTRAIT_SOURCE_FILE ||
  new URL('../pages/character-detail.js', import.meta.url);
const sourceBytes = await readFile(sourceFile);
const source = sourceBytes.toString('utf8');
export const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
export const caseCount = 8;
export const baselineCaseCount = 2;
const expectedPin = process.env.CHARACTER_PORTRAIT_SOURCE_SHA256;
if (expectedPin !== undefined) {
  assert.match(expectedPin, /^[a-f0-9]{64}$/i, 'expected source pin must be raw SHA256');
  assert.equal(sourceSha256, expectedPin.toLowerCase(), 'source bytes do not match expected pin');
}

// Inner callback braces are indented; the column-zero brace closes this function.
// Select its complete original range without copying or patching its implementation.
const ranges = [...source.matchAll(
  /^function bindDetailPortraitFallback\(hero, artist\) \{\r?\n[\s\S]*?^\}/gm,
)];
assert.equal(ranges.length, 1, 'select exactly one actual portrait binding');
const functionSource = ranges[0][0];
export const functionSha256 = createHash('sha256').update(functionSource).digest('hex');
export const functionStartLine = source.slice(0, ranges[0].index).split('\n').length;

const PAGE_URL = 'https://synthetic.invalid/character-detail?slug=qa-portrait';
const MEDIA = Object.freeze({
  aCover: '/portraits/synthetic-a-cover.webp',
  aThumb: '/portraits/synthetic-a-thumb.webp',
  bCover: '/portraits/synthetic-b-cover.webp',
  bThumb: '/portraits/synthetic-b-thumb.webp',
});
const absolute = value => new URL(value, PAGE_URL).href;
const artist = (cover, thumb) => ({ images: { cover, thumb } });

function fixture() {
  const classes = new Set(['detail-hero-card']);
  const classWrites = [];
  let currentImage = null;
  let queryCount = 0;
  const hero = {
    querySelector(selector) {
      assert.equal(selector, '.detail-hero-image', 'only the actual portrait selector is allowed');
      queryCount += 1;
      return currentImage;
    },
    classList: {
      add(value) { classes.add(value); classWrites.push(value); },
      contains(value) { return classes.has(value); },
    },
  };

  function image(initialSource) {
    let src = absolute(initialSource);
    let parent = null;
    const errorListeners = [];
    const srcWrites = [];
    let removals = 0;
    return {
      get src() { return src; },
      set src(value) { src = absolute(value); srcWrites.push(src); },
      get isConnected() { return parent === hero; },
      addEventListener(name, callback) {
        assert.equal(name, 'error');
        assert.equal(typeof callback, 'function');
        errorListeners.push(callback);
      },
      remove() {
        removals += 1;
        if (currentImage === this) currentImage = null;
        parent = null;
      },
      attach(value) { parent = value; },
      emitError() {
        assert.equal(errorListeners.length, 1, 'dispatch the one retained actual error listener');
        errorListeners[0]({ type: 'error', target: this });
      },
      snapshot() {
        return { src, srcWrites: [...srcWrites], removals,
          attached: parent === hero, listeners: errorListeners.length };
      },
    };
  }

  // Synthetic render replacement only; no product fallback or ownership policy here.
  function replace(next, status = 'detail-hero-card') {
    if (currentImage) currentImage.attach(null);
    currentImage = next;
    if (next) next.attach(hero);
    classes.clear();
    for (const token of status.split(/\s+/).filter(Boolean)) classes.add(token);
    classWrites.length = 0;
  }
  function snapshot(images = []) {
    return { classes: [...classes], classWrites: [...classWrites],
      images: images.map(item => item.snapshot()) };
  }
  function denyExternal() {
    throw new Error('portrait fixture forbids transport and external entry points');
  }
  const bind = runInNewContext(`${functionSource}\nbindDetailPortraitFallback;`, {
    URL,
    window: { location: { href: PAGE_URL }, fetch: denyExternal, apiFetch: denyExternal },
    fetch: denyExternal,
    apiFetch: denyExternal,
    XMLHttpRequest: denyExternal,
    WebSocket: denyExternal,
    require: denyExternal,
  }, { timeout: 1000, filename: 'actual-character-portrait-function.js' });
  return { hero, image, replace, snapshot, bind,
    current: () => currentImage, queries: () => queryCount };
}

test('[baseline-race] retired no-fallback error cannot mark the replacement hero unavailable', () => {
  const h = fixture();
  const old = h.image(MEDIA.aCover);
  h.replace(old);
  h.bind(h.hero, artist(MEDIA.aCover, undefined));
  const current = h.image(MEDIA.bCover);
  h.replace(current);
  assert.equal(old.isConnected, false);
  const before = h.snapshot([old, current]);
  old.emitError();
  assert.deepEqual(h.snapshot([old, current]), before,
    'retired terminal callback must not add a class or remove any image');
  assert.equal(h.current(), current);
  assert.equal(h.hero.classList.contains('is-image-unavailable'), false);
});

test('[baseline-race] retired distinct-thumb error cannot retry its detached source', () => {
  const h = fixture();
  const old = h.image(MEDIA.aCover);
  h.replace(old);
  h.bind(h.hero, artist(MEDIA.aCover, MEDIA.aThumb));
  const current = h.image(MEDIA.bCover);
  h.replace(current);
  const before = h.snapshot([old, current]);
  old.emitError();
  assert.deepEqual(h.snapshot([old, current]), before,
    'retired first callback must not assign the distinct thumbnail');
  assert.equal(old.src, absolute(MEDIA.aCover));
  assert.equal(current.src, absolute(MEDIA.bCover));
});

test('current cover retries its relative thumbnail once, then enables the terminal name fallback', () => {
  const h = fixture();
  const current = h.image(MEDIA.aCover);
  h.replace(current);
  h.bind(h.hero, artist(MEDIA.aCover, MEDIA.aThumb));
  current.emitError();
  assert.equal(current.src, absolute(MEDIA.aThumb));
  assert.deepEqual(current.snapshot().srcWrites, [absolute(MEDIA.aThumb)]);
  assert.equal(current.isConnected, true);
  assert.equal(h.hero.classList.contains('is-image-unavailable'), false);
  current.emitError();
  assert.equal(h.current(), null);
  assert.equal(current.isConnected, false);
  assert.equal(current.snapshot().removals, 1);
  assert.deepEqual(current.snapshot().srcWrites, [absolute(MEDIA.aThumb)]);
  // The existing CSS exposes the name through this class; no CSS/browser proof here.
  assert.deepEqual(h.snapshot().classWrites, ['is-image-unavailable']);
  assert.equal(h.hero.classList.contains('is-image-unavailable'), true);
});

test('no portrait image leaves the hero untouched and does not read artist metadata', () => {
  const h = fixture();
  const before = h.snapshot();
  h.bind(h.hero, null);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.current(), null);
  assert.equal(h.queries(), 1);
});

test('current identical cover and thumbnail reaches terminal fallback without retry', () => {
  const h = fixture();
  const current = h.image(MEDIA.aCover);
  h.replace(current);
  h.bind(h.hero, artist(MEDIA.aCover, MEDIA.aCover));
  current.emitError();
  assert.deepEqual(current.snapshot().srcWrites, []);
  assert.equal(current.snapshot().removals, 1);
  assert.equal(h.current(), null);
  assert.deepEqual(h.snapshot().classWrites, ['is-image-unavailable']);
});

test('same-hero B rerender ignores A terminal failure but retains B own retry and terminal behavior', () => {
  const h = fixture();
  const old = h.image(MEDIA.aCover);
  h.replace(old);
  h.bind(h.hero, artist(MEDIA.aCover, MEDIA.aThumb));
  old.emitError();
  assert.equal(old.src, absolute(MEDIA.aThumb));
  const current = h.image(MEDIA.bCover);
  h.replace(current);
  h.bind(h.hero, artist(MEDIA.bCover, MEDIA.bThumb));
  const before = h.snapshot([old, current]);
  old.emitError();
  assert.deepEqual(h.snapshot([old, current]), before);
  assert.equal(h.current(), current);
  current.emitError();
  assert.equal(current.src, absolute(MEDIA.bThumb));
  assert.equal(h.hero.classList.contains('is-image-unavailable'), false);
  current.emitError();
  assert.equal(h.current(), null);
  assert.equal(current.snapshot().removals, 1);
  assert.equal(old.snapshot().removals, 0);
  assert.deepEqual(h.snapshot().classWrites, ['is-image-unavailable']);
});

test('current thumbnail-only portrait retains immediate terminal fallback', () => {
  const h = fixture();
  const current = h.image(MEDIA.aThumb);
  h.replace(current);
  h.bind(h.hero, artist(undefined, MEDIA.aThumb));
  current.emitError();
  assert.deepEqual(current.snapshot().srcWrites, []);
  assert.equal(current.snapshot().removals, 1);
  assert.equal(h.current(), null);
  assert.equal(h.hero.classList.contains('is-image-unavailable'), true);
});

test('retired error during an image-free status render cannot alter the current status hero', () => {
  const h = fixture();
  const old = h.image(MEDIA.aCover);
  h.replace(old);
  h.bind(h.hero, artist(MEDIA.aCover, undefined));
  h.replace(null, 'detail-hero-card is-status');
  const before = h.snapshot([old]);
  old.emitError();
  assert.deepEqual(h.snapshot([old]), before);
  assert.equal(h.current(), null);
  assert.equal(h.hero.classList.contains('is-image-unavailable'), false);
});

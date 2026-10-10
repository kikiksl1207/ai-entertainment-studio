import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Extracted actual functions with synthetic DOM/storage, not the whole app IIFE or a browser.
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const fixtureSource = await readFile(new URL('./artist-gallery-recovery-20261007.test.mjs', import.meta.url), 'utf8');
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];
const baseUri = 'https://gallery-fixture.invalid/artist?view=gallery';
const plain = value => JSON.parse(JSON.stringify(value));

function declaration(text, name) {
  const matches = [...text.matchAll(new RegExp(
    `^(?:async )?function ${name}\\([^\\n]*\\) \\{\\r?\\n[\\s\\S]*?^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `Use the actual ${name} declaration`);
  return matches[0][0];
}

function constant(name) {
  const matches = [...source.matchAll(new RegExp(
    `^const ${name} = (?:[^\\r\\n]+;|\\{\\r?\\n[\\s\\S]*?^\\};)\\r?$`, 'gm'))];
  assert.equal(matches.length, 1, `Use the actual ${name} declaration`);
  return matches[0][0];
}

const rows = [...source.matchAll(/^  "(detail\.gallery\.[^"]+)":\s*(\{[^\r\n]*\}|\{\r?\n[\s\S]*?^  \}),?\r?$/gm)];
const dictionary = plain(runInNewContext(
  `({${rows.map(row => `${JSON.stringify(row[1])}: ${row[2]}`).join(',')}})`, {}, { timeout: 1000 }));
for (const key of ['detail.gallery.error', 'detail.gallery.loading', 'detail.gallery.retry']) {
  for (const locale of locales) assert.ok(dictionary[key]?.[locale]?.trim(), `${key}: ${locale}`);
}

const constants = ['I18N_LOCALES', 'I18N_FALLBACK', 'I18N_STORAGE_KEY',
  'I18N_LOCALE_ALIASES', 'I18N_PUBLIC_LOCALE_MAP'].map(constant).join('\n');
const functions = ['normalizeLocale', 'publicLocale', 't', 'applyI18n', 'setLocale',
  'initGallerySlider'].map(name => declaration(source, name)).join('\n');
// Importing the old module would register its tests; reuse only its fixture declarations.
const scaffold = ['style', 'dom', 'ui', 'hidden', 'terminal']
  .map(name => declaration(fixtureSource, name)).join('\n');
const items = (artist = 'A', count = 5) => Array.from({ length: count }, (_, index) => ({
  src: `/synthetic-gallery/${artist}-${index + 1}.webp`, caption: `Synthetic ${artist} photo ${index + 1}`,
}));

function fixture() {
  const storage = new Map(), localeEvents = [], activity = [];
  const deny = () => { activity.push('denied'); assert.fail('Unexpected network, timer or another workflow'); };
  const bus = new EventTarget();
  class FixtureCustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  }
  bus.addEventListener('lumina:localechange', event => localeEvents.push(plain(event.detail)));
  let clock = 1800000000000;
  class FixtureDate extends Date { static now() { return ++clock; } }
  const localStorage = {
    getItem: key => storage.get(String(key)) ?? null,
    setItem: (key, value) => storage.set(String(key), String(value)),
  };
  const window = { location: { href: baseUri, origin: new URL(baseUri).origin }, localStorage,
    addEventListener: bus.addEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus),
    CustomEvent: FixtureCustomEvent, fetch: deny };
  const context = { assert, baseUri, window, location: window.location, localStorage,
    URL, AbortController, CustomEvent: FixtureCustomEvent, Date: FixtureDate,
    Node: { TEXT_NODE: 3 }, isLoggedIn: () => false, apiFetch: deny, fetch: deny,
    setTimeout: deny, setInterval: deny, requestAnimationFrame: deny, console,
  };
  runInNewContext(`${scaffold}
    globalThis.galleryScaffold = { dom, ui, hidden, terminal };`, context, { timeout: 1000 });
  const host = context.galleryScaffold.dom();
  // applyI18n uses setAttribute; native title reflects that attribute in both directions.
  const reflectTitle = node => {
    Object.defineProperty(node, 'title', {
      get: () => node.getAttribute('title') || '', set: value => node.setAttribute('title', value),
    });
    return node;
  };
  host.created.forEach(reflectTitle);
  const createElement = host.document.createElement;
  host.document.createElement = tag => reflectTitle(createElement(tag));
  host.document.documentElement = { lang: 'ko-KR' };
  host.document.querySelectorAll = selector => host.document.body.querySelectorAll(selector);
  context.document = host.document;
  runInNewContext(`${constants}
    const I18N_DICT = ${JSON.stringify(dictionary)};
    let _currentLocale = "ko-KR";
    let _i18nRequestVersion = 0;
    let gallerySliderEvents = null;
    ${functions}
    globalThis.galleryLocale = { initGallerySlider, setLocale,
      events: () => gallerySliderEvents, storageKey: I18N_STORAGE_KEY };`, context, { timeout: 1000 });
  const api = context.galleryLocale;
  let inventory = items();
  api.initGallerySlider(inventory, 'Synthetic artist A');
  const f = { ...host, api, storage, localeEvents,
    images: () => host.track.querySelectorAll('img'),
    cells: () => host.track.querySelectorAll('[data-lightbox]'),
    ui: cell => context.galleryScaffold.ui(cell),
    hidden: node => context.galleryScaffold.hidden(node),
    terminal: index => context.galleryScaffold.terminal(f, index),
    inventory: () => plain(inventory),
    reinit: replacement => { inventory = replacement; api.initGallerySlider(replacement, 'Synthetic artist B'); },
    noActivity: () => assert.deepEqual(activity, []),
    async pickLocale(locale) {
      const count = localeEvents.length;
      await api.setLocale(locale);
      assert.equal(host.document.documentElement.lang, locale);
      assert.equal(storage.get(api.storageKey), locale);
      assert.equal(localeEvents.length, count + 1, 'Actual setLocale dispatches the locale event');
      assert.equal(localeEvents.at(-1).regionalLocale, locale);
      assert.ok([...storage.keys()].every(key => key === api.storageKey || key === `${api.storageKey}_choice`));
      f.noActivity();
    },
  };
  return f;
}

function mediaState(f) {
  return plain({ inventory: f.inventory(), images: f.images().map(image => ({
    src: image.src, assignments: [...image.assignments], alt: image.alt, loading: image.loading,
  })), cells: f.cells().map(cell => cell.dataset.lightbox), counter: f.counter.textContent,
  previousDisabled: f.previous.disabled, nextDisabled: f.next.disabled,
  scrolls: f.scrolls, lightbox: f.delegatedLightbox });
}

function translated(f, surface, locale, state) {
  assert.equal(surface.status.textContent, dictionary[`detail.gallery.${state}`][locale]);
  assert.equal(surface.retry.title, dictionary['detail.gallery.retry'][locale]);
  assert.equal(surface.retry.getAttribute('aria-label'), dictionary['detail.gallery.retry'][locale]);
  assert.equal(f.hidden(surface.recovery), false);
  assert.equal(surface.retry.disabled, state === 'loading');
}

test('ARTIST-GALLERY-LOCALE-RED terminal error follows locale without image reload', async () => {
  const f = fixture(), surface = f.terminal(0);
  translated(f, surface, 'ko-KR', 'error');
  assert.equal(surface.image.assignments.length, 2, 'Only the existing first-error retry occurred');
  const before = mediaState(f);
  await f.pickLocale('en-US');
  translated(f, surface, 'en-US', 'error');
  assert.deepEqual(mediaState(f), before, 'Locale adds zero src assignments, selection or inventory changes');
  f.noActivity();
});

test('gallery locale recovery: pending explicit retry follows Japanese and its later error', async () => {
  const f = fixture(), surface = f.terminal(0);
  const click = surface.retry.click();
  assert.equal(click.stopCalls, 1);
  translated(f, surface, 'ko-KR', 'loading');
  assert.equal(surface.image.assignments.length, 3);
  const before = mediaState(f);
  await f.pickLocale('ja-JP');
  translated(f, surface, 'ja-JP', 'loading');
  assert.deepEqual(mediaState(f), before);
  surface.image.emit('error');
  translated(f, surface, 'ja-JP', 'error');
  assert.deepEqual(mediaState(f), before, 'Later failure cannot retry automatically');
  f.noActivity();
});

test('gallery locale recovery: five consecutive actual locale changes preserve error and loading media', async () => {
  const f = fixture(), failed = f.terminal(0), pending = f.terminal(1);
  pending.retry.click();
  const before = mediaState(f);
  for (const locale of ['en-US', 'ja-JP', 'zh-CN', 'zh-Hant', 'ko-KR']) {
    await f.pickLocale(locale);
    translated(f, failed, locale, 'error');
    translated(f, pending, locale, 'loading');
    for (const cell of f.cells()) {
      const { retry } = f.ui(cell);
      assert.equal(retry.title, dictionary['detail.gallery.retry'][locale]);
      assert.equal(retry.getAttribute('aria-label'), dictionary['detail.gallery.retry'][locale]);
    }
    assert.deepEqual(mediaState(f), before);
  }
  assert.equal(f.localeEvents.length, 5);
  f.noActivity();
});

test('gallery locale recovery: replacement B stays current after locale change and detached A events', async () => {
  const f = fixture(), old = f.terminal(0), oldEvents = f.api.events();
  const oldAssignments = [...old.image.assignments];
  f.reinit(items('B', 3));
  assert.equal(oldEvents.signal.aborted, true);
  assert.equal(old.image.isConnected, false);
  const current = f.terminal(0), before = mediaState(f);
  await f.pickLocale('en-US');
  translated(f, current, 'en-US', 'error');
  old.image.emit('load');
  old.image.emit('error');
  old.retry.click();
  translated(f, current, 'en-US', 'error');
  assert.deepEqual(mediaState(f), before, 'Old callbacks cannot change or reload B');
  assert.deepEqual([...old.image.assignments], oldAssignments);
  assert.equal(f.inventory().length, 3);
  f.noActivity();
});

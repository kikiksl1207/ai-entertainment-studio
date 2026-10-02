import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../pages/character-detail.js', import.meta.url), 'utf8');
const adapterStart = appSource.indexOf('function publicArtistCopy(');
const adapterEnd = appSource.indexOf('function adaptShortform(');
assert.ok(adapterStart >= 0 && adapterEnd > adapterStart);
const adapterSource = appSource.slice(adapterStart, adapterEnd);
const localeStart = appSource.indexOf('const I18N_LOCALES = [');
const localeEnd = appSource.indexOf('const I18N_DICT = {', localeStart);
assert.ok(localeStart >= 0 && localeEnd > localeStart);
const localeHelpers = runInNewContext(`${appSource.slice(localeStart, localeEnd)}\n({ normalizeLocale, publicLocale })`, {});
const localeCases = [
  ['ko', 'ko-KR'], ['en', 'en-US'], ['ja', 'ja-JP'], ['zh-Hans', 'zh-CN'], ['zh-Hant', 'zh-Hant'],
];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function publicRecord(slug, version = slug) {
  return {
    id: `id-${slug}`, slug, status: 'active', displayName: `${version} source`,
    coverImage: { url: `/${slug}/cover.png` }, thumbnailImage: { url: `/${slug}/thumb.png` },
    assets: [{ usageType: 'gallery', url: `/${slug}/gallery-01.png`, caption: `${version} photo` }],
    profile: {
      summary: `${version} source summary`, publicStory: `${version} source story`,
      publicMetadata: {
        profileFacts: { position: `${version} role` },
        publicCopyByLocale: Object.fromEntries(localeCases.map(([locale]) => [locale, {
          displayName: `${version} ${locale} name`, summary: `${version} ${locale} summary`,
          publicStory: `${version} ${locale} story`,
        }])),
      },
    },
    stats: { followerCount: 7 }, viewer: { isAuthenticated: false },
  };
}

function detailFixture(fetchDetail) {
  const listeners = new Map();
  const calls = [];
  const classList = () => ({ add() {}, remove() {}, toggle() {} });
  const node = () => ({
    innerHTML: '', textContent: '', hidden: false, dataset: {}, style: {}, classList: classList(),
    setAttribute() {}, addEventListener() {}, querySelector: () => null,
    closest: () => ({ classList: classList() }), insertBefore() {}, prepend() {}, remove() {},
  });
  const roots = Object.fromEntries([
    'detailHero', 'detailIntro', 'detailMeta', 'detailGallery', 'detailShorts', 'detailProfile',
    'detailCta', 'detailTagNavigation', 'detailChatSection', 'detailBodySection',
    'detailCtaSection', 'detailTagSection', 'detailChatSelect', 'chatStartLink',
  ].map(id => [id, node()]));
  const heading = node();
  const summary = node();
  const story = node();
  const heroName = node();
  const heroImage = node();
  const bio = node();
  bio.querySelector = () => story;
  roots.detailIntro.querySelector = selector => ({
    'h1[data-cms-key="character-detail.intro.publicName"]': heading,
    '.detail-summary': summary, '.detail-bio': bio,
  })[selector] || null;
  roots.detailHero.querySelector = selector => ({
    '.detail-hero-image': heroImage,
    '.detail-image-fallback, .detail-hero-secret strong': heroName,
  })[selector] || null;
  const document = {
    title: '', documentElement: { style: { setProperty() {} } },
    getElementById: id => roots[id] || null, querySelector: () => null,
    querySelectorAll: () => [], createElement: node,
  };
  const context = {
    document, URLSearchParams, URL, Intl,
    location: { search: '?slug=first', href: 'https://local.test/character-detail', hostname: 'local.test' },
    addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]),
    characters: [], _artists: [], _detailArtistData: null, _currentLocale: 'en-US',
    shouldKeepLocalGallery: () => false, normalizeAssetUrl: value => value || '',
    statusMeta: { public: { className: 'is-public', label: 'Public' } },
    feedEscapeHtml: value => value, initGallerySlider() {}, initLightbox() {},
    isLoggedIn: () => false,
    apiFetch: async (path, options) => {
      calls.push({ path, options });
      return path === '/api/v1/shortforms' ? [] : fetchDetail(path);
    },
    console: { warn() {} },
  };
  context.window = context;
  context.luminaI18n = {
    t: key => key, apply() {}, getRegionalLocale: () => context._currentLocale,
    getLocale: () => localeHelpers.publicLocale(context._currentLocale),
  };
  runInNewContext(pageSource, context);
  runInNewContext(adapterSource, context);
  const dispatch = name => { for (const callback of listeners.get(name) || []) callback(); };
  return {
    context, roots, heading, summary, story, heroName, heroImage, calls,
    changeLocale: locale => { context._currentLocale = localeHelpers.normalizeLocale(locale); dispatch('lumina:localechange'); },
    navigate: slug => { context.location.search = `?slug=${slug}`; dispatch('popstate'); },
    sharedBoot: async response => { context._artists = context.publicArtistsFromApi(await response); },
  };
}

function assertCopy(view, version, locale) {
  assert.equal(view.context.document.title, `${version} ${locale} name \u2014 Lumina Stage`);
  assert.equal(view.heading.textContent, `${version} ${locale} name`);
  assert.equal(view.heroName.textContent, `${version} ${locale} name`);
  assert.equal(view.heroImage.alt, `${version} ${locale} name`);
  assert.equal(view.summary.textContent, `${version} ${locale} summary`);
  assert.equal(view.story.textContent, `${version} ${locale} story`);
}

test('delayed list -> locale-triggered detail -> detail response -> list replacement -> locale switch', async () => {
  const list = deferred();
  const detail = deferred();
  const view = detailFixture(() => detail.promise);
  const boot = view.sharedBoot(list.promise);
  assert.equal(view.calls.length, 0);

  view.changeLocale('ko-KR');
  assert.equal(view.roots.detailHero.dataset.publicArtistState, 'loading');
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].options.throwOnError, true);
  detail.resolve(publicRecord('first', 'detail-current'));
  await flush();
  assertCopy(view, 'detail-current', 'ko');
  const artist = view.context._artists[0];
  const preserved = { images: artist.images, gallery: artist.gallery, profile: artist.profile, tags: artist.tags };
  const response = view.context._detailArtistData;
  const calls = view.calls.length;

  list.resolve([publicRecord('first', 'list-stale')]);
  await boot;
  const sharedArtists = view.context._artists;
  const sharedArtist = sharedArtists[0];
  assert.notEqual(sharedArtist, artist);
  view.changeLocale('en-US');
  assertCopy(view, 'detail-current', 'en');
  assert.equal(artist.publicName, 'detail-current en name');
  assert.equal(sharedArtist.publicName, 'list-stale en name');
  assert.equal(view.context._artists, sharedArtists);
  assert.equal(view.context._detailArtistData, response);
  for (const [key, value] of Object.entries(preserved)) assert.equal(artist[key], value, key);
  assert.equal(view.roots.detailGallery.hidden, false);
  assert.equal(view.calls.length, calls);
  view.changeLocale('ko-KR');
  assertCopy(view, 'detail-current', 'ko');
  assert.equal(view.calls.length, calls);
});

test('all five locales retain current detail translations and assets after a delayed list replacement', async () => {
  for (const [locale, regionalLocale] of localeCases) {
    const list = deferred();
    const detail = deferred();
    const view = detailFixture(() => detail.promise);
    const boot = view.sharedBoot(list.promise);
    const initialLocale = locale === 'ko' ? 'en' : 'ko';
    view.changeLocale(initialLocale);
    detail.resolve(publicRecord('first', 'detail-current'));
    await flush();
    assertCopy(view, 'detail-current', initialLocale);
    const artist = view.context._artists[0];
    const images = artist.images;
    const profile = artist.profile;
    const originalValues = JSON.stringify({ images, profile });
    const response = view.context._detailArtistData;
    const calls = [...view.calls];

    list.resolve([publicRecord('first', 'list-stale')]);
    await boot;
    const sharedArtists = view.context._artists;
    assert.notEqual(sharedArtists[0], artist);
    view.changeLocale(locale);
    await flush();
    assert.equal(view.context.luminaI18n.getLocale(), locale);
    assert.equal(view.context.luminaI18n.getRegionalLocale(), regionalLocale);
    assertCopy(view, 'detail-current', locale);
    assert.equal(artist.publicName, `detail-current ${locale} name`);
    assert.equal(artist.images, images);
    assert.equal(artist.profile, profile);
    assert.equal(JSON.stringify({ images: artist.images, profile: artist.profile }), originalValues);
    assert.equal(view.context._detailArtistData, response);
    assert.equal(view.context._artists, sharedArtists);
    assert.equal(sharedArtists[0].publicName, `list-stale ${locale} name`);
    assert.deepEqual(view.calls, calls);
  }
});

test('late old detail and shared snapshots cannot replace a newer detail during locale changes', async () => {
  const first = deferred();
  const second = deferred();
  const view = detailFixture(path => path.endsWith('/first') ? first.promise : second.promise);
  view.changeLocale('ko-KR');
  view.navigate('second');
  view.context._artists = view.context.publicArtistsFromApi([publicRecord('first', 'cached-first')]);
  view.changeLocale('en-US');
  assert.equal(view.roots.detailHero.dataset.publicArtistState, 'loading');
  assert.equal(view.roots.detailIntro.innerHTML, '');
  assert.equal(view.context._detailArtistData, null);
  second.resolve(publicRecord('second', 'second-current'));
  await flush();
  assertCopy(view, 'second-current', 'en');
  const artist = view.context._artists.find(item => item.slug === 'second');
  const response = view.context._detailArtistData;

  first.resolve(publicRecord('first', 'late-first'));
  await flush();
  assert.equal(view.context._detailArtistData, response);
  assert.equal(view.context._artists.find(item => item.slug === 'second'), artist);
  await view.sharedBoot(Promise.resolve([
    publicRecord('first', 'list-first'), publicRecord('second', 'list-old-second'),
  ]));
  const sharedArtists = view.context._artists;
  const calls = view.calls.length;
  view.changeLocale('ko-KR');
  assertCopy(view, 'second-current', 'ko');
  assert.equal(view.context._detailArtistData, response);
  assert.equal(view.context._artists, sharedArtists);
  assert.equal(sharedArtists[1].publicName, 'list-old-second ko name');
  assert.equal(view.roots.chatStartLink.href, '/character-chat?slug=second');
  assert.equal(view.calls.length, calls);
});

test('a failed new detail cannot resurrect the previous profile from the shared cache', async () => {
  for (const status of [404, 503]) {
    const failed = deferred();
    const view = detailFixture(path => path.endsWith('/first') ? publicRecord('first') : failed.promise);
    view.changeLocale('ko-KR');
    await flush();
    view.navigate('missing');
    await view.sharedBoot(Promise.resolve([publicRecord('first', 'stale-first')]));
    view.changeLocale('en-US');
    failed.reject(Object.assign(new Error(`HTTP ${status}`), { status }));
    await flush();
    const calls = view.calls.length;
    view.changeLocale('ko-KR');
    assert.equal(view.roots.detailHero.dataset.publicArtistState, status === 404 ? 'not-found' : 'error');
    assert.equal(view.context._detailArtistData, null);
    assert.equal(view.roots.detailIntro.innerHTML, '');
    assert.equal(view.roots.detailBodySection.hidden, true);
    assert.equal(view.roots.detailGallery.innerHTML, '');
    assert.doesNotMatch(view.context.document.title, /first/);
    assert.equal(view.calls.length, calls);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('app.js');
const adapter = app.slice(app.indexOf('function publicArtistCopy('), app.indexOf('function adaptShortform('));
const dictionary = runInNewContext(`${app.slice(app.indexOf('const I18N_DICT = {'),
  app.indexOf('\nlet _currentLocale = I18N_FALLBACK;'))}\nI18N_DICT`, {});
const locales = ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant'];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function apiArtist(slug = 'new-public-artist', overrides = {}) {
  return {
    id: `public-${slug}`, slug, status: 'active', displayName: 'Published Artist',
    displayCategory: '아티스트', tags: ['Public tag'],
    coverImage: { url: '/published-cover.png' }, thumbnailImage: { url: '/published-thumb.png' },
    assets: [], profile: { summary: 'Published summary', publicStory: 'Published story',
      publicMetadata: { profileFacts: { position: 'Published role' } } },
    ...overrides,
  };
}

function fixture(page, fetchResponse) {
  const listeners = new Map();
  const calls = [];
  const galleries = [];
  const retry = { addEventListener: (_, callback) => { retry.click = callback; } };
  const classList = { add() {}, remove() {}, toggle() {} };
  const makeRoot = () => ({
    innerHTML: '', hidden: false, textContent: '', dataset: {}, style: {}, classList,
    setAttribute() {}, querySelectorAll: () => [],
    insertBefore() {},
    querySelector(selector) { return selector === '[data-artist-retry]' && this.innerHTML.includes('data-artist-retry') ? retry : null; },
    addEventListener() {}, closest: () => ({ classList, hidden: false }),
  });
  const ids = page === 'home'
    ? ['mainArtistGrid', 'homePublicArtistCount', 'heroFeature', 'homeFeaturedArtistMetric',
      'homeFeaturedArtistName', 'premium', 'debutLineGrid', 'rosterGrid']
    : page === 'character-catalog' ? ['characterCatalog', 'activeFilterNote']
      : ['detailHero', 'detailIntro', 'detailMeta', 'detailGallery', 'detailShorts', 'detailProfile',
        'detailCta', 'detailTagNavigation', 'detailChatSection', 'detailBodySection',
        'detailCtaSection', 'detailTagSection', 'detailChatSelect', 'chatStartLink'];
  const roots = Object.fromEntries(ids.map(id => [id, makeRoot()]));
  const document = {
    title: '', documentElement: { style: { setProperty() {} } },
    getElementById: id => roots[id] || null, querySelector: () => null, createElement: makeRoot,
    querySelectorAll: () => [], addEventListener() {},
  };
  const context = {
    document, URL, URLSearchParams, Intl,
    location: { search: page === 'character-detail' ? '?slug=new-public-artist' : '',
      pathname: page === 'home' ? '/' : `/${page}`, href: 'https://local.test/' },
    addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]),
    luminaI18n: { getLocale: () => 'ko', getRegionalLocale: () => 'ko-KR', apply() {} },
    console: { warn() {}, info() {} },
    apiFetch: async (path, options) => { calls.push({ path, options }); return fetchResponse(path, options); },
    isPublicLineup: artist => artist.status === 'public', isHiddenLineupArtist: () => false,
    compareByPublicLineupOrder: () => 0, getLikesCount: () => 0, formatLikeCount: () => '0',
    artistToneCopy: artist => artist.concept || artist.summary || '', likeButtonHTML: () => '',
    feedEscapeHtml: value => value, mediaStyle: () => '', isLoggedIn: () => false,
    initGallerySlider: items => galleries.push(items), initLightbox() {},
    normalizeAssetUrl: value => value ? `/${value.replace(/^(\.\/|\/)+/, '')}` : '',
    statusMeta: { public: { className: 'is-public', label: 'Public' } },
    _currentLocale: 'ko-KR',
  };
  context.luminaI18n.t = key => dictionary[key]?.[context._currentLocale] || key;
  context.window = context;
  runInNewContext(read('data/characters.js'), context);
  runInNewContext(read('data/artist-profile-locales.js'), context);
  context.characters = context.LuminaStaticData.characters;
  context._artists = context.characters;
  context.shouldKeepLocalGallery = context.LuminaStaticData.shouldKeepLocalGallery;
  runInNewContext(adapter, context);
  runInNewContext(read(`pages/${page}.js`), context);
  const render = page === 'home' ? context.renderMainArtists
    : page === 'character-catalog' ? context.renderCharacterCatalog : context.renderCharacterDetail;
  return { context, roots, calls, galleries, retry, render,
    changeLocale: locale => {
      context._currentLocale = locale;
      for (const callback of listeners.get('lumina:localechange') || []) callback();
      if (page !== 'character-detail') render();
    },
    navigate: search => {
      context.location.search = search;
      for (const callback of listeners.get('popstate') || []) callback();
    } };
}

test('public artist loading-state copy is complete in all five supported languages', () => {
  const keys = new Set(['home', 'character-catalog', 'character-detail'].flatMap(page =>
    [...read(`pages/${page}.js`).matchAll(/artist\.public\.[A-Za-z]+/g)].map(match => match[0])));
  assert.equal(keys.size, 8);
  for (const key of keys) {
    for (const locale of locales) assert.ok(dictionary[key]?.[locale], `${key} missing ${locale}`);
  }
});

for (const page of ['home', 'character-catalog', 'character-detail']) {
  const rootId = page === 'home' ? 'mainArtistGrid'
    : page === 'character-catalog' ? 'characterCatalog' : 'detailHero';
  test(`${page}: language changes translate loading, failure and retry without another request`, async () => {
    const pending = deferred();
    const view = fixture(page, () => pending.promise);
    view.render();
    for (const locale of locales) {
      view.changeLocale(locale);
      assert.ok(view.roots[rootId].innerHTML.includes(dictionary['artist.public.loading'][locale]));
      assert.equal(view.calls.length, 1);
    }
    pending.reject(new Error('HTTP 503'));
    await flush();
    for (const locale of locales) {
      view.changeLocale(locale);
      assert.ok(view.roots[rootId].innerHTML.includes(dictionary['artist.public.error'][locale]));
      assert.ok(view.roots[rootId].innerHTML.includes(dictionary['artist.public.retry'][locale]));
      if (page === 'character-detail') {
        assert.ok(view.roots[rootId].innerHTML.includes(dictionary['artist.public.catalog'][locale]));
      }
      assert.equal(view.calls.length, 1);
    }
  });
}

for (const page of ['home', 'character-catalog']) {
  const rootId = page === 'home' ? 'mainArtistGrid' : 'characterCatalog';
  test(`${page}: API failure never renders seeded artists, and retry renders only published records`, async () => {
    let response = null;
    const view = fixture(page, () => response);
    view.render();
    assert.equal(view.roots[rootId].dataset.publicArtistsState, 'loading');
    await flush();
    assert.equal(view.roots[rootId].dataset.publicArtistsState, 'error');
    assert.match(view.roots[rootId].innerHTML, /불러오지 못했습니다/);
    assert.doesNotMatch(view.roots[rootId].innerHTML, /clickable-card|윤세린|choi-seojin/);
    if (page === 'home') {
      assert.equal(view.roots.homePublicArtistCount.textContent, '');
      assert.equal(view.roots.heroFeature.hidden, true);
      assert.equal(view.roots.premium.hidden, true);
      assert.equal(view.roots.rosterGrid.innerHTML, '');
    }
    response = [apiArtist()];
    view.retry.click();
    view.retry.click();
    await flush();
    assert.equal(view.calls.length, 2, 'deduplicate retry while loading');
    assert.equal(view.calls[0].options.throwOnError, true);
    assert.equal(view.roots[rootId].dataset.publicArtistsState, 'ready');
    assert.match(view.roots[rootId].innerHTML, /Published Artist/);
    assert.doesNotMatch(view.roots[rootId].innerHTML, /윤세린|choi-seojin/);
    // A shared boot fallback cannot replace a verified page snapshot.
    view.context._artists = view.context.characters;
    view.render();
    assert.match(view.roots[rootId].innerHTML, /Published Artist/);
  });

  test(`${page}: successful empty list is distinct from failure and can be retried`, async () => {
    const view = fixture(page, () => []);
    view.render();
    await flush();
    assert.equal(view.roots[rootId].dataset.publicArtistsState, 'ready');
    assert.match(view.roots[rootId].innerHTML, /현재 공개된 아티스트가 없습니다/);
    assert.doesNotMatch(view.roots[rootId].innerHTML, /불러오지 못했습니다|clickable-card/);
    if (page === 'home') assert.equal(view.roots.homePublicArtistCount.textContent, '0명');
    view.retry.click();
    await flush();
    assert.equal(view.calls.length, 2);
  });

  test(`${page}: HTTP errors and malformed responses fail closed`, async () => {
    for (const response of [new Error('HTTP 503'), { items: [] }, [apiArtist('incomplete', { assets: {} })]]) {
      const view = fixture(page, () => {
        if (response instanceof Error) throw response;
        return response;
      });
      view.render();
      await flush();
      assert.equal(view.roots[rootId].dataset.publicArtistsState, 'error');
      assert.doesNotMatch(view.roots[rootId].innerHTML, /clickable-card/);
    }
  });

  test(`${page}: locale refresh keeps the verified snapshot if shared boot restores an older cache`, async () => {
    const record = apiArtist('new-public-artist', { profile: { publicMetadata: { publicCopyByLocale: {
      ko: { displayName: '공개 이름' }, en: { displayName: 'Published English Name' },
    } } } });
    const view = fixture(page, () => [record]);
    view.render();
    await flush();
    assert.match(view.roots[rootId].innerHTML, /공개 이름/);
    const artist = view.context._artists[0];
    const images = artist.images;
    view.context._artists = view.context.characters;
    view.context._currentLocale = 'en-US';
    view.context.refreshPublicArtistLocale();
    view.render();
    assert.match(view.roots[rootId].innerHTML, /Published English Name/);
    assert.equal(view.context._artists[0], artist);
    assert.equal(artist.images, images);
    assert.equal(view.calls.length, 1);
  });
}

test('catalog preserves type, status and URL tag filters across loading and retry', async () => {
  let response = null;
  const view = fixture('character-catalog', () => response);
  view.context.location.search = '?tag=Public%20tag';
  view.render('모델', 'Public tag', 'candidate');
  await flush();
  response = [apiArtist('model', { displayCategory: '모델', tier: 'candidate' }), apiArtist('actor')];
  view.retry.click();
  await flush();
  assert.match(view.roots.characterCatalog.innerHTML, /slug=model/);
  assert.doesNotMatch(view.roots.characterCatalog.innerHTML, /slug=actor/);
  assert.match(view.roots.activeFilterNote.innerHTML, /Public tag|모델/);
  view.navigate('?tag=missing');
  assert.match(view.roots.characterCatalog.innerHTML, /선택한 조건에 맞는/);
  assert.match(view.roots.activeFilterNote.innerHTML, /missing/);
});

test('detail uses its own public API even if the list is unavailable or the cache is stale', async () => {
  const pending = deferred();
  const view = fixture('character-detail', path => path.endsWith('/new-public-artist') ? pending.promise : []);
  view.render();
  assert.equal(view.roots.detailHero.dataset.publicArtistState, 'loading');
  assert.equal(view.roots.detailBodySection.hidden, true);
  pending.resolve(apiArtist());
  await flush();
  assert.equal(view.roots.detailHero.dataset.publicArtistState, 'ready');
  assert.match(view.roots.detailIntro.innerHTML, /Published summary/);
  assert.equal(view.roots.chatStartLink.href, '/character-chat?slug=new-public-artist');
  assert.equal(view.roots.detailGallery.hidden, true);
  assert.equal(view.calls.filter(call => call.path.includes('/artists/')).length, 1);
});

test('detail distinguishes missing slug, 404, inactive, invalid payload and API failure; retry recovers', async () => {
  for (const response of [null, new Error('HTTP 503'), Object.assign(new Error('HTTP 404'), { status: 404 }),
    apiArtist('new-public-artist', { status: 'planned' }), apiArtist('different-artist')]) {
    let current = response;
    const view = fixture('character-detail', () => {
      if (current instanceof Error) throw current;
      return current;
    });
    view.render();
    await flush();
    const notFound = response?.status === 404 || response?.status === 'planned';
    assert.equal(view.roots.detailHero.dataset.publicArtistState, notFound ? 'not-found' : 'error');
    assert.match(view.roots.detailHero.innerHTML, notFound ? /찾을 수 없습니다/ : /불러오지 못했습니다/);
    assert.equal(view.roots.detailIntro.innerHTML, '');
    assert.equal(view.roots.detailCtaSection.hidden, true);
    current = apiArtist();
    view.retry.click();
    await flush();
    assert.equal(view.roots.detailHero.dataset.publicArtistState, 'ready');
    assert.match(view.roots.detailIntro.innerHTML, /Published summary/);
  }
  const view = fixture('character-detail', () => { throw new Error('Must not fetch'); });
  view.context.location.search = '';
  view.render();
  assert.equal(view.roots.detailHero.dataset.publicArtistState, 'no-slug');
  assert.equal(view.calls.length, 0);
});

test('detail navigation discards old profiles and out-of-order detail and shorts responses', async () => {
  const first = deferred();
  const second = deferred();
  const oldShorts = deferred();
  const view = fixture('character-detail', path => {
    if (path.endsWith('/first')) return first.promise;
    if (path.endsWith('/second')) return second.promise;
    if (path === '/api/v1/shortforms') return oldShorts.promise;
    return apiArtist('third', { displayName: 'Third Artist' });
  });
  view.navigate('?slug=first');
  view.navigate('?slug=second');
  second.resolve(apiArtist('second', { displayName: 'Second Artist' }));
  await flush();
  first.resolve(apiArtist('first', { displayName: 'Stale Artist' }));
  await flush();
  assert.match(view.roots.detailIntro.innerHTML, /Second Artist/);
  assert.doesNotMatch(view.roots.detailIntro.innerHTML, /Stale Artist/);
  view.navigate('?slug=third');
  assert.equal(view.roots.detailIntro.innerHTML, '');
  await flush();
  oldShorts.resolve([{ status: 'published', artist: { slug: 'second' }, title: 'Stale Short',
    assets: [{ assetType: 'video', mimeType: 'video/mp4', url: '/stale.mp4' }] }]);
  await flush();
  assert.match(view.roots.detailIntro.innerHTML, /Third Artist/);
  assert.equal(view.roots.detailShorts.innerHTML, '');
  view.navigate('');
  assert.equal(view.roots.detailIntro.innerHTML, '');
  assert.equal(view.roots.detailCta.innerHTML, '');
});

test('approved fourteen-image galleries and thumbnails survive empty or older server galleries', async () => {
  for (const assets of [[], [{ usageType: 'gallery', url: '/server-old.png' }]]) {
    const view = fixture('character-detail', path => path.includes('/artists/') ? apiArtist('nam-ian', { assets }) : []);
    const local = view.context.characters.find(artist => artist.slug === 'nam-ian');
    view.navigate('?slug=nam-ian');
    await flush();
    assert.equal(view.galleries.at(-1).length, 14);
    assert.ok(view.galleries.at(-1).every(item => !item.src.includes('server-old')));
    const artist = view.context._artists.find(item => item.slug === 'nam-ian');
    assert.equal(artist.images.thumb, view.context.normalizeAssetUrl(local.images.thumb));
    assert.equal(view.roots.detailGallery.hidden, false);
  }
});

test('detail preserves disputed-fact and unapproved fandom guards while applying public facts', async () => {
  const view = fixture('character-detail', path => path.includes('/artists/') ? apiArtist('seo-yuan', {
    profile: { publicMetadata: { profileFacts: {
      height: '177cm', position: 'Published position', fandomNameCandidate: 'Do Not Publish', fandomNameStatus: 'candidate',
    } } },
  }) : []);
  view.navigate('?slug=seo-yuan');
  await flush();
  assert.match(view.roots.detailProfile.innerHTML, /is-pending/);
  assert.doesNotMatch(view.roots.detailProfile.innerHTML, /177cm|Do Not Publish/);
  assert.match(view.roots.detailProfile.innerHTML, /Published position/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = script.indexOf('function publicArtistCopy(');
const end = script.indexOf('function adaptShortform(', start);
assert.ok(start >= 0 && end > start, 'artist adapter functions must be present');

function adapter(locale) {
  const context = {
    _currentLocale: locale,
    _artists: [],
    characters: [{
      slug: 'visible', name: '옛 이름', publicName: '옛 이름', type: '모델', tier: 'candidate',
      status: 'public', summary: '옛 소개', intro: '확정된 이야기',
      profile: { 신체: '160cm', 포지션: '옛 역할', 데뷔: 'Lumina Stage 신규 후보' },
      images: { cover: '/old-cover.png', thumb: '/old-thumb.png' }, gallery: [],
    }, {
      slug: 'seo-yuan', name: '서유안', publicName: '서유안', type: '모델',
      summary: '한국어 소개', intro: '한국어 이야기', profile: { 팬덤명: 'Yuan Room' },
    }, { slug: 'withheld', status: 'public' }],
    shouldKeepLocalGallery: () => false,
    normalizeAssetUrl: (value) => value || '',
  };
  runInNewContext(`${script.slice(start, end)}; globalThis.artistAdapter = { publicArtistsFromApi, adaptArtist, refreshPublicArtistLocale };`, context);
  return {
    ...context.artistAdapter,
    setLocale: value => { context._currentLocale = value; },
    cache: artists => { context._artists = artists; },
  };
}

const active = {
  id: 'artist-id', slug: 'visible', status: 'active', displayName: '새 이름', displayCategory: '배우',
  coverImage: { url: '/new-cover.png' }, thumbnailImage: { url: '/new-thumb.png' },
  profile: { summary: '새 소개', publicMetadata: { profileFacts: { height: '171cm', position: '새 역할' } } },
  assets: [],
};

test('a successful public API list never restores locally seeded but withheld artists', () => {
  const { publicArtistsFromApi } = adapter();
  const listed = publicArtistsFromApi([active, { ...active, slug: 'inactive', status: 'planned' }]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].slug, 'visible');
  assert.equal(publicArtistsFromApi([]).length, 0);
});

test('published profile and name edits override stale local facts', () => {
  const { adaptArtist } = adapter();
  const artist = adaptArtist(active);
  assert.equal(artist.name, '새 이름');
  assert.equal(artist.publicName, '새 이름');
  assert.equal(artist.type, '배우');
  assert.equal(artist.summary, '새 소개');
  assert.equal(artist.profile.신체, '171cm');
  assert.equal(artist.profile.포지션, '새 역할');
});

test('localized published profile facts replace older local profile values', () => {
  const { adaptArtist } = adapter();
  const artist = adaptArtist({
    ...active,
    profile: { publicMetadata: { profileFacts: {
      신체: '174cm', 포지션: '새 활동', 나이: '29세', 대표장면: '새로운 장면',
    } } },
  });
  assert.equal(artist.profile.신체, '174cm');
  assert.equal(artist.profile.포지션, '새 활동');
  assert.equal(artist.profile.나이, '29세');
  assert.equal(artist.profile.대표장면, '새로운 장면');
});

test('Korean artist copy does not yield to English seed text or publish a candidate fandom name', () => {
  const { adaptArtist } = adapter('ko-KR');
  const artist = adaptArtist({ ...active, slug: 'seo-yuan', displayName: 'Seo Yuan',
    profile: { summary: 'English summary', publicStory: 'English story',
      publicMetadata: { profileFacts: {
        fandomNameCandidate: 'Yuandear', fandomNameStatus: 'candidate',
      } } },
  });
  assert.equal(artist.publicName, '서유안');
  assert.equal(artist.summary, '한국어 소개');
  assert.equal(artist.intro, '한국어 이야기');
  assert.equal(artist.profile.팬덤명, undefined);
  assert.equal(artist.fandomNameApproved, false);
});

test('approved fandom names can appear and English copy remains available in English locale', () => {
  const { adaptArtist } = adapter('en-US');
  const artist = adaptArtist({ ...active, slug: 'seo-yuan', displayName: 'Seo Yuan',
    profile: { summary: 'English summary', publicStory: 'English story',
      publicMetadata: { profileFacts: {
        fandomNameCandidate: 'Yuandear', fandomNameStatus: 'approved',
      } } },
  });
  assert.equal(artist.publicName, 'Seo Yuan');
  assert.equal(artist.summary, 'English summary');
  assert.equal(artist.intro, 'English story');
  assert.equal(artist.profile.팬덤명, 'Yuandear');
  assert.equal(artist.fandomNameApproved, true);
});

test('cached public copy follows all five locales without rebuilding media or admitting candidate text', () => {
  const view = adapter('ko-KR');
  const [artist] = view.publicArtistsFromApi([{
    ...active, slug: 'seo-yuan', displayName: 'Seo Yuan',
    profile: { summary: 'English summary', publicStory: 'English story', publicMetadata: {
      profileFacts: { fandomNameCandidate: 'Unapproved', fandomNameStatus: 'candidate' },
    } },
  }]);
  view.cache([artist]);
  const images = artist.images;
  const gallery = [{ src: '/approved-gallery.png', caption: 'Approved' }];
  artist.gallery = gallery;
  artist._stats = { followerCount: 12 };
  for (const [locale, name, summary, intro] of [
    ['en-US', 'Seo Yuan', 'English summary', 'English story'],
    ['ja-JP', 'Seo Yuan', 'English summary', 'English story'],
    ['zh-CN', 'Seo Yuan', 'English summary', 'English story'],
    ['zh-Hant', 'Seo Yuan', 'English summary', 'English story'],
    ['ko-KR', '서유안', '한국어 소개', '한국어 이야기'],
  ]) {
    view.setLocale(locale);
    view.refreshPublicArtistLocale();
    assert.equal(artist.publicName, name);
    assert.equal(artist.summary, summary);
    assert.equal(artist.intro, intro);
    assert.equal(artist.profile.팬덤명, undefined);
    assert.equal(artist.images, images);
    assert.equal(artist.gallery, gallery);
    assert.equal(artist._stats.followerCount, 12);
  }
});

test('unfinished published copy stays out of the cache on every locale switch', () => {
  const view = adapter('ko-KR');
  const [artist] = view.publicArtistsFromApi([{
    ...active, slug: 'seo-yuan', displayName: 'Seo Yuan',
    profile: { summary: 'A planned candidate', publicStory: 'This candidate is being prepared' },
  }]);
  view.cache([artist]);
  for (const locale of ['en-US', 'ja-JP', 'zh-CN', 'zh-Hant', 'ko-KR']) {
    view.setLocale(locale);
    view.refreshPublicArtistLocale();
    assert.equal(artist.summary, '한국어 소개');
    assert.equal(artist.intro, '한국어 이야기');
  }
});

test('unfinished public API copy cannot replace a complete local artist profile', () => {
  const { adaptArtist } = adapter();
  const artist = adaptArtist({ ...active, profile: {
    summary: 'A planned character candidate for chat.',
    publicStory: 'This planned candidate is being prepared.',
    publicMetadata: { profileFacts: {
      height: 'TBD', position: 'lead visual 후보', debut: 'Lumina Stage planned candidate',
      hobbies: ['독서', '준비 중'],
    } },
  } });
  assert.equal(artist.summary, '옛 소개');
  assert.equal(artist.intro, '확정된 이야기');
  assert.equal(artist.profile.신체, '160cm');
  assert.equal(artist.profile.포지션, '옛 역할');
  assert.equal(artist.profile.데뷔, undefined);
  assert.equal(artist.profile.취미, '독서');
});

test('a newly published artist has a usable card name and role without local seed data', () => {
  const { publicArtistsFromApi } = adapter();
  const [artist] = publicArtistsFromApi([{ ...active, slug: 'new-artist', displayName: '신규 아티스트' }]);
  assert.equal(artist.name, '신규 아티스트');
  assert.equal(artist.publicName, '신규 아티스트');
  assert.equal(artist.role, '새 역할');
});

test('artist adapter rejects malformed profile facts and color values', () => {
  const { adaptArtist } = adapter();
  const artist = adaptArtist({
    ...active,
    visual: { primaryColor: '#fff; background:url(x)' },
    profile: { publicMetadata: { profileFacts: { height: { bad: true }, hobbies: ['독서', { bad: true }] } } },
  });
  assert.equal(artist.profile.신체, '160cm');
  assert.equal(artist.profile.취미, '독서');
  assert.equal(artist.colorAccent, '#9f8bc7');
});

test('background media accepts image URLs without injecting HTML or CSS declarations', () => {
  const escapeStart = script.indexOf('function feedEscapeHtml(');
  const escapeEnd = script.indexOf('function normalizeFeedAuthorType(', escapeStart);
  const mediaStart = script.indexOf('function mediaStyle(');
  const mediaEnd = script.indexOf('function isHiddenLineupArtist(', mediaStart);
  assert.ok(escapeStart >= 0 && escapeEnd > escapeStart && mediaStart >= 0 && mediaEnd > mediaStart);
  const context = {};
  runInNewContext(`${script.slice(escapeStart, escapeEnd)}\n${script.slice(mediaStart, mediaEnd)}\n` +
    'globalThis.mediaStyleForTest = mediaStyle;', context);
  const media = context.mediaStyleForTest;
  assert.match(media('./assets/cover.png'), /url\('\.\/assets\/cover\.png'\)/);
  assert.match(media('https://cdn.example.com/cover.png'), /url\('https:\/\/cdn\.example\.com\/cover\.png'\)/);
  for (const unsafe of ['javascript:alert(1)', '//other.example/x',
    '/x.png" onmouseover="alert(1)', "/x.png');background:url(x)", '/x.png\\27;']) {
    assert.equal(media(unsafe), '', unsafe);
  }
});

test('new-artist catalog filter includes public candidate-tier artists, not private candidates', () => {
  const catalog = readFileSync(new URL('../pages/character-catalog.js', import.meta.url), 'utf8');
  const from = catalog.indexOf('function catalogStatusMatches(');
  const to = catalog.indexOf('function renderCatalogMedia(', from);
  assert.ok(from >= 0 && to > from);
  const context = {};
  runInNewContext(`${catalog.slice(from, to)}; globalThis.matches = catalogStatusMatches;`, context);
  assert.equal(context.matches({ status: 'public', tier: 'candidate' }, 'candidate'), true);
  assert.equal(context.matches({ status: 'secret', tier: 'candidate' }, 'candidate'), false);
  assert.equal(context.matches({ status: 'public', tier: 'main' }, 'candidate'), false);
  assert.equal(context.matches({ status: 'public', tier: 'main' }, 'public'), true);
});

test('home hides unpublished featured artists and uses the actual public artist name', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="homeFeaturedArtistMetric" hidden/);
  assert.match(html, /id="premium" class="content-section" hidden/);
  const home = readFileSync(new URL('../pages/home.js', import.meta.url), 'utf8');
  const elements = Object.fromEntries(['heroFeature', 'homeFeaturedArtistMetric', 'homeFeaturedArtistName', 'premium', 'mainArtistGrid']
    .map(id => [id, { hidden: id !== 'heroFeature', innerHTML: '', textContent: '', dataset: {},
      setAttribute() {}, querySelector: () => ({ addEventListener: (_, callback) => { elements.retry = callback; } }) }]));
  let apiArtists = [];
  const context = {
    document: { getElementById: id => elements[id] ?? null },
    _artists: [],
    apiFetch: async () => apiArtists,
    publicArtistsFromApi: artists => artists,
    isPublicLineup: artist => artist.status === 'public',
    compareByPublicLineupOrder: () => 0,
    getLikesCount: () => 0,
    formatLikeCount: () => '0',
    artistToneCopy: () => '',
  };
  context.window = context;
  runInNewContext(home, context);
  context.renderMainArtists();
  await new Promise(resolve => setImmediate(resolve));
  context.renderHeroFeature();
  context.renderPremiumFeature();
  assert.equal(elements.heroFeature.hidden, true);
  assert.equal(elements.homeFeaturedArtistMetric.hidden, true);
  assert.equal(elements.premium.hidden, true);

  apiArtists = [{
    slug: 'new-artist', status: 'public', publicName: '공개 아티스트', summary: '소개',
    images: { thumb: '/thumb.png' }, tags: [],
  }];
  elements.retry();
  await new Promise(resolve => setImmediate(resolve));
  context.renderHeroFeature();
  context.renderPremiumFeature();
  assert.equal(elements.heroFeature.hidden, false);
  assert.equal(elements.homeFeaturedArtistMetric.hidden, false);
  assert.equal(elements.homeFeaturedArtistName.textContent, '공개 아티스트');
  assert.equal(elements.premium.hidden, true);
});

test('home artist cards escape published display text and reject unsafe accent CSS', async () => {
  const home = readFileSync(new URL('../pages/home.js', import.meta.url), 'utf8');
  const elements = Object.fromEntries(['mainArtistGrid', 'homePublicArtistCount', 'heroFeature',
    'homeFeaturedArtistMetric', 'homeFeaturedArtistName'].map(id => [id, {
      innerHTML: '', textContent: '', hidden: false, dataset: {}, setAttribute() {}, querySelector: () => null }]));
  const apiArtists = [{ slug: 'artist', status: 'public', name: '<b>이름</b>', publicName: '<b>이름</b>',
    role: '배우', summary: '<script>alert(1)</script>', images: { thumb: '/thumb.png' },
    tags: ['<img src=x>'], colorAccent: 'red; background:url(x)' }];
  const context = {
    document: { getElementById: id => elements[id] ?? null },
    _artists: apiArtists,
    apiFetch: async () => apiArtists,
    publicArtistsFromApi: artists => artists,
    isPublicLineup: artist => artist.status === 'public',
    compareByPublicLineupOrder: () => 0,
    getLikesCount: () => 0,
    formatLikeCount: () => '0',
    artistToneCopy: artist => artist.summary,
  };
  context.window = context;
  runInNewContext(home, context);
  context.renderMainArtists();
  await new Promise(resolve => setImmediate(resolve));
  context.renderHeroFeature();
  assert.match(elements.mainArtistGrid.innerHTML, /&lt;b&gt;이름&lt;\/b&gt;/);
  assert.match(elements.heroFeature.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(elements.mainArtistGrid.innerHTML, /--char-accent: #9f8bc7/);
  assert.doesNotMatch(elements.mainArtistGrid.innerHTML, /<img src=x>/);
});

test('public artist catalog does not advertise unpublished profiles or a private filter', () => {
  const html = readFileSync(new URL('../characters/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /yoon-serin|choi-seojin|윤세린|최서진/);
  assert.doesNotMatch(html, /data-status-filter="secret"/);
  assert.match(html, /data-status-filter="candidate"/);
  assert.match(html, /assets\/brand\/lumina-stage-logo\.png/);
});

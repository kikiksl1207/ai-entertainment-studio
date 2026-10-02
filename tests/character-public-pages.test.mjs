import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://lumina-page.test';
let browser;

const artist = {
  slug: 'test-artist', publicName: '테스트 아티스트', type: '아티스트', tier: 'main', status: 'public',
  summary: '공식 소개', intro: '', concept: '', fandom: '', business: null, tags: ['팬 태그'],
  profile: { 포지션: '보컬', 생년월일: '', 혈액형: null, MBTI: 'N/A' },
  images: { thumb: '/missing-thumb.png', cover: '/existing-cover.png' },
  gallery: [{ caption: 'Portrait', src: '/existing-cover.png' }], shorts: [],
};

const runtime = `
  var _artists = window.testArtists;
  var statusMeta = {
    public: { className: 'is-public', label: '공개 활동 중', summaryLabel: '활동 중' },
    secret: { className: 'is-secret', label: '비공개 라인', summaryLabel: '비공개' },
    pending: { className: 'is-secret', label: '공개 예정', summaryLabel: '공개 예정' }
  };
  function compareByPublicLineupOrder() { return 0; }
  function getLikesCount() { return 0; }
  function likeButtonHTML() { return ''; }
  function artistToneCopy(a) { return a.concept || a.summary || ''; }
  function getCharacterBySlug(slug) { return _artists.find(a => a.slug === slug); }
  function shouldKeepLocalGallery() { return true; }
  function initGallerySlider() {}
  function initLightbox() {}
  function mediaStyle() { return ''; }
  function feedEscapeHtml(value) { return value; }
  function isLoggedIn() { return false; }
  function publicArtistsFromApi(records) {
    return records.filter(record => record.status === 'active')
      .map(record => window.testArtists.find(artist => artist.slug === record.slug));
  }
  async function apiFetch(path) {
    if (window.testApiFailure) throw new Error('Public API unavailable');
    const records = window.testArtists.map(artist => ({ ...artist, id: 'test-' + artist.slug,
      status: artist.status === 'public' ? 'active' : artist.status }));
    if (path === '/api/v1/artists') return records;
    if (path.startsWith('/api/v1/artists/')) {
      const record = records.find(artist => path.endsWith('/' + encodeURIComponent(artist.slug)));
      if (!record) throw Object.assign(new Error('Not found'), { status: 404 });
      return record;
    }
    return null;
  }
  window.testLocale = 'ko';
  window.luminaI18n = { getLocale: () => window.testLocale };
  window.setTestLocale = function (locale) {
    window.testLocale = locale;
    window.dispatchEvent(new CustomEvent('lumina:localechange', { detail: { locale } }));
  };
  document.body.classList.remove('is-booting');
`;

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
});
after(async () => browser?.close());

async function openPage(routeName, width, artists, query = '', apiFailure = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript((value) => { window.testArtists = value; }, artists);
  await context.addInitScript(value => { window.testApiFailure = value; }, apiFailure);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const files = {
      '/characters': 'characters/index.html',
      '/character-detail': 'character-detail/index.html',
      '/styles.css': 'styles.css',
      '/styles/character-catalog.css': 'styles/character-catalog.css',
      '/styles/character-detail.css': 'styles/character-detail.css',
      '/pages/character-catalog.js': 'pages/character-catalog.js',
      '/pages/character-detail.js': 'pages/character-detail.js',
      '/data/artist-profile-locales.js': 'data/artist-profile-locales.js',
      '/existing-cover.png': 'assets/characters/yoon-serin/cover.png',
    };
    if (url.pathname === '/app.js') return route.fulfill({ body: runtime, contentType: 'text/javascript' });
    if (url.pathname === '/data/characters.js' || url.pathname === '/cms-bootstrap.js') {
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    }
    const file = files[url.pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.png') ? 'image/png' : 'text/html';
    return route.fulfill({ body: await readFile(path.join(repo, file)), contentType });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/${routeName}${query}`);
  await page.evaluate(routeName === 'characters'
    ? 'bindCharacterFilters(); renderCharacterCatalog("all", new URLSearchParams(location.search).get("tag") || "")'
    : 'renderCharacterDetail()');
  await page.waitForFunction(() => {
    const state = document.getElementById('characterCatalog')?.dataset.publicArtistsState ||
      document.getElementById('detailHero')?.dataset.publicArtistState;
    return state && state !== 'loading';
  });
  return { page, errors, close: () => context.close() };
}

test('catalog omits empty fields, falls back to cover, and preserves detail route', async () => {
  const view = await openPage('characters', 390, [artist]);
  try {
    const { page } = view;
    await page.locator('.catalog-image').waitFor();
    await page.waitForFunction(() => document.querySelector('.catalog-image')?.naturalWidth > 0);
    assert.equal(await page.locator('.catalog-details div').count(), 0);
    assert.equal(await page.locator('.catalog-card').getAttribute('data-href'), '/character-detail?slug=test-artist');
    assert.match(await page.locator('.catalog-image').getAttribute('src'), /existing-cover/);
    const media = await page.locator('.catalog-media').boundingBox();
    assert.ok(media.width <= 370 && media.height < 500, JSON.stringify(media));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('public API failure retries without exposing seeded catalog cards or stale detail profiles', async () => {
  for (const [routeName, query, rootId, readySelector] of [
    ['characters', '', 'characterCatalog', '.catalog-card'],
    ['character-detail', '?slug=test-artist', 'detailHero', '#detailIntro h1'],
  ]) {
    const view = await openPage(routeName, 390, [artist], query, true);
    try {
      const { page } = view;
      assert.match(await page.locator(`#${rootId}`).innerText(), /불러오지 못했습니다/);
      assert.equal(await page.locator(readySelector).count(), 0);
      if (routeName === 'character-detail') assert.equal(await page.locator('#detailChatSection').isVisible(), false);
      await page.evaluate(() => { window.testApiFailure = false; });
      await page.locator('[data-artist-retry]').click();
      await page.locator(readySelector).waitFor();
      assert.match(await page.locator(readySelector).innerText(), /테스트 아티스트/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
  }
});

test('empty filtered catalog keeps the filter note and reset navigation', async () => {
  const view = await openPage('characters', 400, [artist], '?tag=not-present');
  try {
    assert.equal(await view.page.locator('.catalog-empty').count(), 1);
    assert.match(await view.page.locator('#activeFilterNote').innerText(), /not-present/);
    assert.equal(await view.page.locator('#activeFilterNote a').getAttribute('href'), '/characters');
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('catalog and detail show a named fallback when both portrait URLs fail', async () => {
  const withoutMedia = { ...artist, images: { thumb: '/missing-thumb.png', cover: '/missing-cover.png' } };
  for (const [routeName, query, selector] of [
    ['characters', '', '.catalog-media.is-image-unavailable'],
    ['character-detail', '?slug=test-artist', '.detail-hero-card.is-image-unavailable'],
  ]) {
    const view = await openPage(routeName, 400, [withoutMedia], query);
    try {
      await view.page.locator(selector).waitFor();
      assert.match(await view.page.locator(selector).innerText(), /테스트 아티스트/);
      assert.equal(await view.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
  }
});

for (const width of [390, 400]) {
  test(`detail profile, portrait fallback, route and mobile grid at ${width}px`, async () => {
    const view = await openPage('character-detail', width, [artist], '?slug=test-artist');
    try {
      const { page } = view;
      await page.waitForFunction(() => document.querySelector('.detail-hero-image')?.naturalWidth > 0);
      assert.match(await page.locator('.detail-hero-image').getAttribute('src'), /existing-cover/);
      assert.equal(await page.locator('#detailProfile > div').count(), 1);
      assert.match(await page.locator('#detailProfile').innerText(), /보컬/);
      assert.doesNotMatch(await page.locator('#detailProfile').innerText(), /N\/A|undefined/);
      assert.equal(await page.locator('#chatStartLink').getAttribute('href'), '/character-chat?slug=test-artist');
      assert.equal(await page.locator('.detail-sns-section').isVisible(), false);
      const gallery = await page.locator('#detailGallery').boundingBox();
      const profile = await page.locator('.detail-profile-block').boundingBox();
      assert.ok(profile.y >= gallery.y + gallery.height - 1, 'profile should stack below gallery');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
  });
}

test('missing and hidden detail routes do not expose chat navigation', async () => {
  for (const [artists, query] of [[[artist], '?slug=unknown'], [[{ ...artist, status: 'secret' }], '?slug=test-artist']]) {
    const view = await openPage('character-detail', 390, artists, query);
    try {
      assert.equal(await view.page.locator('#detailChatSection').isVisible(), false);
      if (query.includes('unknown')) {
        assert.equal(await view.page.locator('#detailBodySection').isVisible(), false);
        assert.equal(await view.page.locator('#detailHero a').getAttribute('href'), '/characters');
      }
      assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
  }
});

test('characters without a gallery keep only the profile section', async () => {
  const view = await openPage('character-detail', 390, [{ ...artist, gallery: [], galleryMode: 'hidden' }], '?slug=test-artist');
  try {
    assert.equal(await view.page.locator('#detailGallery').isVisible(), false);
    assert.equal(await view.page.locator('#detailProfile').isVisible(), true);
    assert.equal(await view.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('published artist category and tier render as text in detail metadata', async () => {
  const malicious = { ...artist, type: '<img src=x onerror=alert(1)>',
    tier: '<svg onload=alert(1)>' };
  const view = await openPage('character-detail', 390, [malicious], '?slug=test-artist');
  try {
    const meta = view.page.locator('#detailMeta');
    assert.match(await meta.innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.match(await meta.innerText(), /<svg onload=alert\(1\)>/);
    assert.equal(await meta.locator('img, svg[onload]').count(), 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('detail profile switches confirmed facts with the selected locale', async () => {
  const localizedArtist = { ...artist, slug: 'yoon-serin', profile: {
    '생년월일': '2001년 3월 14일 (만 25세)',
    '포지션': '메인 비주얼 / 퍼포먼스 센터',
    '팬덤명': 'Serinist'
  } };
  const view = await openPage('character-detail', 400, [localizedArtist], '?slug=yoon-serin');
  try {
    await view.page.evaluate(() => window.setTestLocale('en'));
    assert.equal(await view.page.locator('#detailProfile dt').first().innerText(), 'Date of birth');
    assert.match(await view.page.locator('#detailProfile').innerText(), /Main Visual\/Performance Center/);
    assert.doesNotMatch(await view.page.locator('#detailProfile').innerText(), /Serinist/);
    await view.page.evaluate(() => window.setTestLocale('ja'));
    assert.equal(await view.page.locator('#detailProfile dt').first().innerText(), '生年月日');
    for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
      await view.page.evaluate((next) => window.setTestLocale(next), locale);
      assert.ok((await view.page.locator('#detailProfile dt').first().innerText()).length > 0, locale);
      assert.equal(await view.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, locale);
    }
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('approved fandom name can appear after public profile approval', async () => {
  const approved = { ...artist, slug: 'yoon-serin', fandomNameApproved: true,
    profile: { '팬덤명': 'Serinist' } };
  const view = await openPage('character-detail', 390, [approved], '?slug=yoon-serin');
  try {
    assert.match(await view.page.locator('#detailProfile').innerText(), /Serinist/);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('detail profile does not replace changed or disputed source facts with stale translations', async () => {
  const updated = { ...artist, slug: 'han-seoyul', profile: {
    '생년월일': '2000년 1월 1일', '신체': '180cm', '포지션': '새 포지션'
  } };
  const view = await openPage('character-detail', 390, [updated], '?slug=han-seoyul');
  try {
    await view.page.evaluate(() => window.setTestLocale('en'));
    const profile = await view.page.locator('#detailProfile').innerText();
    assert.doesNotMatch(profile, /2000|180cm/);
    assert.match(profile, /새 포지션/);
    assert.equal(await view.page.locator('#detailProfile .is-pending').count(), 2);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

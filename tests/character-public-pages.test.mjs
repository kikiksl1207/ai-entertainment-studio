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
  async function apiFetch() { return null; }
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

async function openPage(routeName, width, artists, query = '') {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript((value) => { window.testArtists = value; }, artists);
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

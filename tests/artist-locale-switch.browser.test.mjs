import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const adapter = app.slice(app.indexOf('function publicArtistCopy('), app.indexOf('function adaptShortform('));
assert.match(adapter, /function refreshPublicArtistLocale\(/);
const origin = 'http://artist-locale.test';
const image = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

const runtime = `
  let _currentLocale = 'ko-KR';
  const characters = window.testLocalArtist ? [window.testLocalArtist] : [{ slug: 'seo-yuan', name: '서유안', publicName: '서유안',
    type: '아티스트', tier: 'candidate', status: 'public', summary: '한국어 소개',
    intro: '한국어 이야기', concept: '', profile: {}, images: { cover: '/cover.png', thumb: '/cover.png' },
    gallery: [{ src: '/cover.png', caption: 'Approved' }], tags: [] }];
  let _artists = [];
  const statusMeta = { public: { className: 'is-public', label: '공식 활동 중',
    labelKey: 'character.status.public.label', summaryKey: 'character.status.public.summary' } };
  function normalizeAssetUrl(url) { return url || ''; }
  function shouldKeepLocalGallery() { return true; }
  function getCharacterBySlug(slug) { return _artists.find(artist => artist.slug === slug); }
  function compareByPublicLineupOrder() { return 0; }
  function getLikesCount() { return 0; }
  function likeButtonHTML() { return ''; }
  function artistToneCopy(artist) { return artist.concept || artist.summary || ''; }
  function feedEscapeHtml(value) { return String(value ?? ''); }
  function mediaStyle() { return ''; }
  function initGallerySlider() {}
  function initLightbox() {}
  function isLoggedIn() { return true; }
  window.testCalls = [];
  async function apiFetch(url) {
    window.testCalls.push(url);
    if (url === '/api/v1/shortforms') return [];
    if (url === '/api/v1/artists') return [publicRecord];
    return { ...publicRecord, stats: { followerCount: 25 },
      viewer: { isAuthenticated: true, canUnfollow: true, isFollowing: true } };
  }
  window.luminaI18n = {
    t: key => ({ 'detail.support.heading': _currentLocale === 'en-US'
      ? "Support {name}'s next stage" : '{name}의 다음 무대를 응원하세요' })[key] || key,
    getLocale: () => ({ 'ko-KR': 'ko', 'en-US': 'en', 'ja-JP': 'ja',
      'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' })[_currentLocale],
    getRegionalLocale: () => _currentLocale,
    apply() {},
  };
  ${adapter}
  const publicRecord = window.testPublicRecord || { id: 'artist-id', slug: 'seo-yuan', status: 'active',
    displayName: 'Seo Yuan', displayCategory: '아티스트',
    coverImage: { url: '/cover.png' }, thumbnailImage: { url: '/cover.png' },
    profile: { summary: 'English summary', publicStory: 'English story', publicMetadata: {
      profileFacts: { position: '내추럴 럭셔리 모델',
        fandomNameCandidate: 'Yuan Room', fandomNameStatus: 'candidate' },
      publicCopyByLocale: {
        ko: { displayName: '서유안', summary: '한국어 소개', publicStory: '한국어 이야기' },
        en: { displayName: 'Seo Yuan', summary: 'English summary', publicStory: 'English story' },
        ja: { displayName: 'ソ・ユアン', summary: '日本語の紹介', publicStory: '日本語の物語' },
        'zh-Hans': { displayName: '徐佑安', summary: '简体中文简介', publicStory: '简体中文故事' },
        'zh-Hant': { displayName: '徐佑安', summary: '繁體中文簡介', publicStory: '繁體中文故事' },
      },
    } }, assets: [] };
  _artists = publicArtistsFromApi([publicRecord]);
  window.testSetLocale = locale => {
    _currentLocale = locale;
    document.documentElement.lang = locale;
    window.dispatchEvent(new CustomEvent('lumina:localechange', { detail: { regionalLocale: locale } }));
  };
  document.body.classList.remove('is-booting');
`;

async function openPage(browser, routeName, width, onCmsRequest, artistOverride) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
  if (artistOverride) await context.addInitScript(value => {
    window.testPublicRecord = value.record; window.testLocalArtist = value.local;
  }, artistOverride);
  if (onCmsRequest) await context.addInitScript(base => { window.LUMINA_API_BASE = base; }, origin);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/app.js') return route.fulfill({ body: runtime, contentType: 'text/javascript' });
    if (url.pathname === '/api/v1/site-content/bootstrap' && onCmsRequest) return onCmsRequest(route, url);
    if (url.pathname === '/data/characters.js' || (url.pathname === '/cms-bootstrap.js' && !onCmsRequest)) {
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    }
    if (url.pathname === '/cover.png') return route.fulfill({ body: image, contentType: 'image/gif' });
    if (artistOverride && url.pathname.startsWith('/assets/characters/')) {
      return route.fulfill({ body: image, contentType: 'image/gif' });
    }
    const files = {
      '/characters': 'characters/index.html',
      '/character-detail': 'character-detail/index.html',
      '/styles.css': 'styles.css',
      '/styles/character-catalog.css': 'styles/character-catalog.css',
      '/styles/character-detail.css': 'styles/character-detail.css',
      '/pages/character-catalog.js': 'pages/character-catalog.js',
      '/pages/character-detail.js': 'pages/character-detail.js',
      '/data/artist-profile-locales.js': 'data/artist-profile-locales.js',
      '/cms-bootstrap.js': 'cms-bootstrap.js',
    };
    const file = files[url.pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: await readFile(path.join(repo, file)),
      contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/${routeName}${routeName === 'character-detail' ? `?slug=${artistOverride?.record.slug || 'seo-yuan'}` : ''}`);
  await page.evaluate(routeName === 'character-detail'
    ? 'renderCharacterDetail()'
    : 'renderCharacterCatalog(); bindCharacterFilters()');
  await page.waitForFunction(() => document.getElementById('characterCatalog')?.dataset.publicArtistsState === 'ready' ||
    document.getElementById('detailHero')?.dataset.publicArtistState === 'ready');
  return { page, errors, close: () => context.close() };
}

async function assertTextFits(page, selectors) {
  const result = await page.evaluate(selectors => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    clipped: selectors.filter(selector => {
      const element = document.querySelector(selector);
      return element && element.scrollWidth > element.clientWidth + 1;
    }),
  }), selectors);
  assert.ok(result.pageWidth <= result.viewportWidth + 1, JSON.stringify(result));
  assert.deepEqual(result.clipped, []);
}

test('the eight approved fandom names survive API projection and all five detail locales without approving candidates', { timeout: 120000 }, async () => {
  const manifest = JSON.parse(readFileSync(new URL('../server/prisma/approved-public-artists-2026-09-27.json', import.meta.url), 'utf8'));
  const approved = manifest.artists.filter(artist => typeof artist.profileFacts['팬덤명'] === 'string');
  assert.equal(approved.length, 8);
  const translations = { window: {} };
  runInNewContext(readFileSync(new URL('../data/artist-profile-locales.js', import.meta.url), 'utf8'), translations);
  const typescript = createRequire(new URL('../server/package.json', import.meta.url))('typescript');
  const policySource = readFileSync(new URL('../server/src/public/artists/approved-artist-profile.policy.ts', import.meta.url), 'utf8');
  const policy = { exports: {} };
  runInNewContext(typescript.transpileModule(policySource, { compilerOptions: {
    module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2021,
  } }).outputText, { exports: policy.exports });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    for (const width of [390, 400, 1280]) for (const artist of approved) {
      const record = { id: artist.slug, slug: artist.slug, status: 'active', displayName: artist.displayName,
        coverImage: { url: `/${artist.cover}` }, thumbnailImage: { url: `/${artist.thumb}` }, assets: [],
        profile: policy.exports.approvedPublicArtistProfile(artist.slug, 'active', {
          summary: artist.summary, publicStory: artist.publicStory,
          publicMetadata: { approvedRelease: manifest.release, profileFacts: artist.profileFacts },
        }) };
      const local = { slug: artist.slug, name: artist.displayName, publicName: artist.displayName,
        type: '아티스트', tier: 'main', status: 'public', profile: artist.profileFacts,
        images: { cover: `/${artist.cover}`, thumb: `/${artist.thumb}` }, gallery: [], tags: [] };
      const detail = await openPage(browser, 'character-detail', width, undefined, { record, local });
      try {
        for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-TW']) {
          await detail.page.evaluate(locale => window.testSetLocale(locale), locale);
          const expectedRows = /후보/.test(artist.profileFacts['데뷔'] || '') ? 14 : 15;
          assert.equal(await detail.page.locator('#detailProfile > div').count(), expectedRows);
          const profileText = await detail.page.locator('#detailProfile').innerText();
          const localeKey = { 'ko-KR': 'ko', 'en-US': 'en', 'ja-JP': 'ja', 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' }[locale];
          const expectedName = translations.window.LuminaStaticData.artistProfileByLocale[artist.slug][localeKey]
            .find(row => row.key === '팬덤명').value;
          assert.ok(profileText.includes(expectedName), `${artist.slug} ${locale}: ${profileText}`);
          await assertTextFits(detail.page, ['#detailIntro h1', '.detail-summary', '#detailProfile']);
        }
        assert.deepEqual(detail.errors, []);
      } finally { await detail.close(); }
    }
  } finally { await browser.close(); }
});

test('artist detail and filtered catalog switch all five locales in place at mobile and desktop widths', async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    for (const width of [390, 1280]) {
      const detail = await openPage(browser, 'character-detail', width);
      try {
        await detail.page.waitForSelector('[data-detail-follow]:not([hidden])');
        await detail.page.evaluate(() => {
          window.initialCalls = window.testCalls.length;
          window.initialGallery = document.getElementById('detailGallery');
          window.initialFollow = document.querySelector('[data-detail-follow]');
        });
        for (const [locale, name, summary, intro, position] of [
          ['en-US', 'Seo Yuan', 'English summary', 'English story', 'natural luxury model'],
          ['ja-JP', 'ソ・ユアン', '日本語の紹介', '日本語の物語', 'ナチュラルラグジュアリーモデル'],
          ['zh-CN', '徐佑安', '简体中文简介', '简体中文故事', '自然轻奢模特'],
          ['zh-TW', '徐佑安', '繁體中文簡介', '繁體中文故事', '自然輕奢模特'],
          ['ko-KR', '서유안', '한국어 소개', '한국어 이야기', '내추럴 럭셔리 모델'],
        ]) {
          await detail.page.evaluate(locale => window.testSetLocale(locale), locale);
          assert.equal(await detail.page.locator('#detailIntro h1').innerText(), name);
          assert.equal(await detail.page.locator('.detail-summary').innerText(), summary);
          assert.equal(await detail.page.locator('.detail-bio > p').first().innerText(), intro);
          assert.match(await detail.page.locator('#detailProfile').innerText(), new RegExp(position));
          assert.doesNotMatch(await detail.page.locator('#detailProfile').innerText(), /Yuan Room/);
          assert.equal(await detail.page.locator('[data-detail-support-heading]').getAttribute('data-artist-name'), name);
          assert.equal(await detail.page.title(), `${name} — Lumina Stage`);
          assert.deepEqual(await detail.page.evaluate(() => ({
            gallerySame: window.initialGallery === document.getElementById('detailGallery'),
            followSame: window.initialFollow === document.querySelector('[data-detail-follow]'),
            following: window.initialFollow.dataset.following,
            requests: window.testCalls.length,
            initialRequests: window.initialCalls,
          })), { gallerySame: true, followSame: true, following: '1',
            requests: await detail.page.evaluate(() => window.initialCalls),
            initialRequests: await detail.page.evaluate(() => window.initialCalls) });
          await assertTextFits(detail.page, ['#detailIntro h1', '.detail-summary', '#detailProfile']);
        }
        assert.deepEqual(detail.errors, []);
      } finally { await detail.close(); }

      const catalog = await openPage(browser, 'characters', width);
      try {
        await catalog.page.locator('[data-status-filter="candidate"]').click();
        assert.match(await catalog.page.locator('#characterCatalog').innerText(), /서유안/);
        for (const [locale, name, summary] of [
          ['en-US', 'Seo Yuan', 'English summary'],
          ['ja-JP', 'ソ・ユアン', '日本語の紹介'],
          ['zh-CN', '徐佑安', '简体中文简介'],
          ['zh-TW', '徐佑安', '繁體中文簡介'],
          ['ko-KR', '서유안', '한국어 소개'],
        ]) {
          await catalog.page.evaluate(locale => window.testSetLocale(locale), locale);
          assert.equal(await catalog.page.locator('.catalog-name').innerText(), name);
          assert.equal(await catalog.page.locator('.catalog-summary').innerText(), summary);
          assert.equal((await catalog.page.locator('[data-status-filter="candidate"]').getAttribute('class'))?.includes('is-active'), true);
          assert.deepEqual(await catalog.page.evaluate(() => window.testCalls), ['/api/v1/artists']);
          await assertTextFits(catalog.page, ['.catalog-name', '.catalog-summary']);
        }
        assert.deepEqual(catalog.errors, []);
      } finally { await catalog.close(); }
    }
  } finally { await browser.close(); }
});

test('late CMS responses cannot replace artist copy after a ko-en-ko switch', { timeout: 45000 }, async () => {
  const pending = new Map();
  const arrivals = new Map();
  const onCmsRequest = (route, url) => {
    const locale = url.searchParams.get('locale');
    assert.equal(url.searchParams.get('characterSlug'), 'seo-yuan');
    pending.set(locale, content => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ content }),
    }));
    arrivals.get(locale)?.();
    return new Promise(resolve => {
      const respond = pending.get(locale);
      pending.set(locale, async content => { await respond(content); resolve(); });
    });
  };
  const waitForCms = locale => pending.has(locale) ? Promise.resolve() : new Promise(resolve => arrivals.set(locale, resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const detail = await openPage(browser, 'character-detail', 390, onCmsRequest);
    try {
      await waitForCms('ko-KR');
      await detail.page.evaluate(() => window.testSetLocale('en-US'));
      await waitForCms('en-US');
      const koResponse = detail.page.waitForResponse(response =>
        response.url().includes('/api/v1/site-content/bootstrap?') &&
        new URL(response.url()).searchParams.get('locale') === 'ko-KR');
      await pending.get('ko-KR')({
        'character-detail.intro.publicName': { title: 'Korean CMS name' },
        'character-detail.intro.summary': { body: 'Korean CMS summary' },
      });
      await koResponse;
      await detail.page.waitForTimeout(50);
      assert.equal(await detail.page.locator('#detailIntro h1').innerText(), 'Seo Yuan');
      assert.equal(await detail.page.locator('.detail-summary').innerText(), 'English summary');

      await detail.page.evaluate(() => window.testSetLocale('ko-KR'));
      await detail.page.waitForFunction(() => document.querySelector('#detailIntro h1')?.textContent === 'Korean CMS name');
      assert.equal(await detail.page.locator('.detail-summary').innerText(), 'Korean CMS summary');
      const enResponse = detail.page.waitForResponse(response =>
        response.url().includes('/api/v1/site-content/bootstrap?') &&
        new URL(response.url()).searchParams.get('locale') === 'en-US');
      await pending.get('en-US')({
        'character-detail.intro.publicName': { title: 'English CMS name' },
        'character-detail.intro.summary': { body: 'English CMS summary' },
      });
      await enResponse;
      await detail.page.waitForTimeout(50);
      assert.equal(await detail.page.locator('#detailIntro h1').innerText(), 'Korean CMS name');
      assert.equal(await detail.page.locator('.detail-summary').innerText(), 'Korean CMS summary');
      assert.deepEqual(detail.errors, []);
    } finally { await detail.close(); }
  } finally { await browser.close(); }
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.env.ARTIST_QA_ARTIFACTS;
const slugs = ['yoon-serin', 'han-seoyul', 'park-doa', 'choi-seojin', 'cha-dohyun',
  'seo-yuan', 'min-chaeon', 'ha-yuna',
  'nam-ian', 'jang-taegeon', 'bae-seongpil', 'jung-doyun', 'lim-jaeguk',
  'seo-hamin', 'ryu-taeo', 'cha-mawang', 'seo-ika', 'baek-toga',
  'kwon-bandong', 'kang-sia', 'lee-jiwon', 'baek-ria', 'oh-yuna'];
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'data/characters.js'), 'utf8'), sandbox);
const artists = slugs.map(slug => {
  const local = sandbox.window.LuminaStaticData.characters.find(item => item.slug === slug);
  assert.ok(local, `missing local artist ${slug}`);
  return {
    id: `qa-${slug}`, slug, status: 'active', displayName: local.publicName,
    displayCategory: local.type, tier: local.tier,
    coverImage: { url: local.images.cover }, thumbnailImage: { url: local.images.thumb },
    profile: { summary: local.summary, publicStory: local.intro },
    assets: local.gallery.map(item => ({ usageType: 'gallery', url: item.src, caption: item.caption })),
  };
});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function siteServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let file = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!file.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

async function layout(page, selectors = []) {
  return page.evaluate(selectors => {
    const box = element => {
      const rect = element?.getBoundingClientRect();
      return rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    return {
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      controls: Object.fromEntries(selectors.map(selector => [selector, box(document.querySelector(selector))])),
    };
  }, selectors);
}

function checkHorizontalFit(result, label, issues) {
  if (result.document > result.viewport + 1) issues.push(`${label}: document ${result.document}px > ${result.viewport}px`);
  for (const [selector, rect] of Object.entries(result.controls)) {
    if (!rect || !rect.width || !rect.height || rect.left < -1 || rect.right > result.viewport + 1) {
      issues.push(`${label}: ${selector} outside viewport (${JSON.stringify(rect)})`);
    }
  }
}

test('public artist roster, profile, gallery and chat entry fit at 390px and 1280px', { timeout: 480_000 }, async () => {
  if (output) await mkdir(output, { recursive: true });
  const server = siteServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const issues = [];
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      await context.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.origin === 'https://api.lumina-stage.com') {
          if (url.pathname === '/api/v1/artists') return route.fulfill({ json: artists,
            headers: { 'access-control-allow-origin': '*' } });
          const artist = artists.find(item => url.pathname === `/api/v1/artists/${item.slug}`);
          if (artist) return route.fulfill({ json: artist,
            headers: { 'access-control-allow-origin': '*' } });
          return route.fulfill({ status: 404, json: {}, headers: { 'access-control-allow-origin': '*' } });
        }
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${base}/characters`, { waitUntil: 'domcontentloaded' });
        await page.locator('.catalog-card').first().waitFor();
        assert.equal(await page.locator('.catalog-card').count(), artists.length);
        checkHorizontalFit(await layout(page, ['#characterFilters', '#characterStatusFilters', '#characterCatalog']), `${width} roster`, issues);
        if (output) await page.screenshot({ path: join(output, `roster-${width}.png`) });
        if (output) await page.screenshot({ path: join(output, `roster-full-${width}.png`), fullPage: true });

        const lastFilter = page.locator('#characterFilters .filter-chip').last();
        await lastFilter.scrollIntoViewIfNeeded();
        const filterEnd = await lastFilter.boundingBox();
        assert.ok(filterEnd.x >= -1 && filterEnd.x + filterEnd.width <= width + 1, `${width}px last roster filter unreachable`);

        for (const artist of artists) {
          const card = page.locator(`.catalog-card[data-href*="${artist.slug}"]`);
          await card.locator('a.text-link').click();
          await page.locator('#detailIntro h1').waitFor();
          assert.match(await page.locator('#detailIntro h1').innerText(), new RegExp(artist.displayName));
          await page.locator('.detail-hero-image').evaluate(img => img.decode());
          if (width === 390) {
            const firstFold = await page.evaluate(() => ({
              name: document.querySelector('#detailIntro h1').getBoundingClientRect().bottom,
              tabbar: document.querySelector('.mobile-tabbar').getBoundingClientRect().top,
            }));
            if (firstFold.name > firstFold.tabbar - 8) {
              issues.push(`${width} ${artist.slug}: profile name obscured by bottom navigation`);
            }
          }
          checkHorizontalFit(await layout(page, ['#detailHero', '#detailIntro', '#detailMeta', '#detailChatSelect', '#detailGallery', '#detailProfile']), `${width} ${artist.slug} profile`, issues);
          if (output) await page.screenshot({ path: join(output, `${artist.slug}-profile-${width}.png`) });

          const gallery = page.locator('#detailGallery');
          await page.evaluate(() => {
            const panel = document.getElementById('detailGallery');
            const header = document.querySelector('.site-header');
            window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - header.getBoundingClientRect().height - 16,
              behavior: 'instant' });
          });
          const galleryLayout = await layout(page, ['.site-header', '#detailGallery', '#galleryHeader', '#galleryPrev', '#galleryCounter', '#galleryNext', '#gallerySlider']);
          checkHorizontalFit(galleryLayout, `${width} ${artist.slug} gallery`, issues);
          if (galleryLayout.controls['#galleryHeader']?.top < galleryLayout.controls['.site-header']?.bottom - 1) {
            issues.push(`${width} ${artist.slug}: gallery navigation hidden under sticky header`);
          }
          const slider = galleryLayout.controls['#gallerySlider'];
          if (slider && slider.height > slider.width * (width <= 640 ? 1.05 : 1.4)) {
            issues.push(`${width} ${artist.slug}: gallery thumbnails stretched to ${Math.round(slider.width)}x${Math.round(slider.height)}`);
          }
          const header = galleryLayout.controls['#galleryHeader'];
          for (const selector of ['#galleryPrev', '#galleryCounter', '#galleryNext']) {
            const rect = galleryLayout.controls[selector];
            if (rect && header && (rect.left < header.left - 1 || rect.right > header.right + 1)) {
              issues.push(`${width} ${artist.slug}: ${selector} clipped by gallery header`);
            }
          }
          await page.locator('#galleryNext').click();
          await page.waitForFunction(() => {
            const slider = document.getElementById('gallerySlider');
            return document.querySelector('#galleryCounter')?.textContent?.startsWith('5') &&
              Math.abs(slider.scrollLeft - slider.offsetWidth) <= 1;
          });
          await page.locator('.gallery-slide[data-lightbox="4"] img').evaluate(img => img.decode());
          await page.evaluate(() => {
            const panel = document.getElementById('detailGallery');
            const header = document.querySelector('.site-header');
            window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - header.getBoundingClientRect().height - 16,
              behavior: 'instant' });
          });
          if (output) await page.screenshot({ path: join(output, `${artist.slug}-gallery-${width}.png`) });
          await page.locator('.gallery-slide[data-lightbox="4"]').click();
          await page.locator('.encar-lightbox.is-open .encar-main-img').waitFor();
          await page.locator('.encar-lightbox.is-open .encar-main-img').evaluate(img => img.decode());
          const lightboxLayout = await layout(page, ['.encar-lightbox.is-open', '.encar-lightbox.is-open .encar-main-img', '.encar-close', '.encar-prev', '.encar-next']);
          checkHorizontalFit(lightboxLayout, `${width} ${artist.slug} lightbox`, issues);
          for (const selector of ['.encar-lightbox.is-open .encar-main-img', '.encar-close', '.encar-next']) {
            const rect = lightboxLayout.controls[selector];
            if (rect && (rect.top < -1 || rect.bottom > 845)) issues.push(`${width} ${artist.slug}: ${selector} clipped vertically`);
          }
          if (output) await page.screenshot({ path: join(output, `${artist.slug}-lightbox-${width}.png`) });
          await page.locator('.encar-close').click();
          await page.locator('#chatStartLink').click();
          await page.waitForFunction(name => document.querySelector('#chatHeroName')?.textContent?.includes(name), artist.displayName);
          assert.match(await page.locator('#chatHeroName').innerText(), new RegExp(artist.displayName));
          const chatLayout = await layout(page, ['.site-header', '#chatRoomShell', '.dm-topbar', '#premiumChatRoomStatus', '#chatFeaturedPeer', '#chatStage', '#chatStarterCard', '#chatInputForm', '#chatInput', '#chatSendBtn']);
          checkHorizontalFit(chatLayout, `${width} ${artist.slug} chat`, issues);
          if (width === 390 && chatLayout.controls['#chatInputForm']?.bottom > 844) {
            issues.push(`${width} ${artist.slug}: chat composer below viewport (${JSON.stringify(chatLayout.controls)})`);
          }
          if (output) await page.screenshot({ path: join(output, `${artist.slug}-chat-entry-${width}.png`) });
          await page.locator('#chatPlusToggle').click();
          const menuLayout = await layout(page, ['.site-header', '#chatActionMenu']);
          checkHorizontalFit(menuLayout, `${width} ${artist.slug} chat menu`, issues);
          const menu = menuLayout.controls['#chatActionMenu'];
          if (width === 390 && menu &&
            (menu.top < menuLayout.controls['.site-header'].bottom - 1 || menu.bottom > 845)) {
            issues.push(`${width} ${artist.slug}: chat actions hidden behind header or viewport`);
          }
          if (output) await page.screenshot({ path: join(output, `${artist.slug}-chat-${width}.png`) });
          await page.goto(`${base}/characters`, { waitUntil: 'domcontentloaded' });
          await page.locator(`.catalog-card[data-href*="${artist.slug}"]`).waitFor();
        }
        assert.deepEqual(errors, [], `${width}px page errors`);
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(issues, [], issues.join('\n'));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('public artist without gallery remains visible from roster through chat at 390px and 1280px', { timeout: 120_000 }, async () => {
  if (output) await mkdir(output, { recursive: true });
  const server = siteServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const local = sandbox.window.LuminaStaticData.characters.find(item => item.slug === 'oh-hyerin');
  const published = {
    id: 'qa-oh-hyerin', slug: 'oh-hyerin', status: 'active', displayName: local.publicName,
    displayCategory: local.type, tier: local.tier,
    coverImage: { url: local.images.cover }, thumbnailImage: { url: local.images.thumb },
    profile: { summary: local.summary, publicStory: local.intro },
    assets: [
      { usageType: 'cover', url: local.images.cover },
      { usageType: 'thumb', url: local.images.thumb },
    ],
  };
  const browser = await chromium.launch({ headless: true,
    ...(process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const issues = [];
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      await context.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.origin === 'https://api.lumina-stage.com') {
          if (url.pathname === '/api/v1/artists') return route.fulfill({ json: [published],
            headers: { 'access-control-allow-origin': '*' } });
          if (url.pathname === '/api/v1/artists/oh-hyerin') return route.fulfill({ json: published,
            headers: { 'access-control-allow-origin': '*' } });
          return route.fulfill({ status: 404, json: {}, headers: { 'access-control-allow-origin': '*' } });
        }
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`${base}/characters`, { waitUntil: 'domcontentloaded' });
        const card = page.locator('.catalog-card[data-href*="oh-hyerin"]');
        await card.waitFor();
        assert.equal(await page.locator('.catalog-card').count(), 1);
        await card.locator('.catalog-image').evaluate(img => img.decode());
        checkHorizontalFit(await layout(page, ['#characterCatalog', '.catalog-card']), `${width} no-gallery roster`, issues);
        if (output) await page.screenshot({ path: join(output, `oh-hyerin-roster-${width}.png`) });

        await card.locator('a.text-link').click();
        await page.locator('#detailIntro h1').waitFor();
        assert.equal(await page.locator('#detailIntro h1').innerText(), local.publicName);
        await page.locator('.detail-hero-image').evaluate(img => img.decode());
        await page.waitForFunction(() => document.getElementById('detailGallery')?.hidden);
        assert.equal(await page.locator('#detailGallery').isVisible(), false);
        assert.equal(await page.locator('#detailProfile').isVisible(), true);
        assert.equal(await page.locator('#chatStartLink').isVisible(), true);
        const body = await page.locator('.detail-body-grid').boundingBox();
        const profile = await page.locator('.detail-profile-block').boundingBox();
        assert.ok(Math.abs(body.width - profile.width) <= 1, `${width}px profile should fill the body grid`);
        checkHorizontalFit(await layout(page, ['#detailHero', '#detailIntro', '#detailProfile', '#detailChatSelect']), `${width} no-gallery profile`, issues);
        if (output) await page.screenshot({ path: join(output, `oh-hyerin-profile-${width}.png`), fullPage: true });

        await page.locator('#chatStartLink').click();
        await page.waitForFunction(name => document.querySelector('#chatHeroName')?.textContent?.includes(name), local.publicName);
        checkHorizontalFit(await layout(page, ['#chatRoomShell', '#chatInputForm']), `${width} no-gallery chat`, issues);
        if (output) await page.screenshot({ path: join(output, `oh-hyerin-chat-entry-${width}.png`) });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    assert.deepEqual(issues, [], issues.join('\n'));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

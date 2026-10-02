import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.LUMINA_LIVE_QA_URL;
const paths = ['/', '/characters', '/story-stage', '/ott', '/lumina-feed', '/lumina-pick'];
const loadedContent = { '/': '#mainArtistGrid .artist-card', '/characters': '#characterCatalog .catalog-card',
  '/story-stage': '.story-pack-card', '/lumina-feed': '#luminaFeedList .feed-post' };
const artifacts = process.env.LUMINA_LIVE_QA_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-live-readonly-20260928';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

test('public site navigation and page width remain readable without changing user data',
  { skip: !base, timeout: 180_000 }, async () => {
    await mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 } });
        await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
        await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
        for (const path of paths) {
          const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          assert.equal(response?.status(), 200, `${path} HTTP status`);
          await page.locator('body.is-ready').waitFor({ timeout: 15_000 });
          if (loadedContent[path]) await page.locator(loadedContent[path]).first().waitFor({ timeout: 20_000 });
          if (path === '/lumina-pick') await page.waitForFunction(() => {
            const root = document.getElementById('mainPickLeader');
            return !!root?.textContent?.trim() && !/불러오는 중|Loading/i.test(root.textContent);
          }, undefined, { timeout: 20_000 });
          const layout = await page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            links: [...document.querySelectorAll('.main-nav > a')].map((el) => new URL(el.href).pathname),
            mobile: [...document.querySelectorAll('.mobile-tabbar > a')].map((el) => new URL(el.href).pathname),
            main: document.querySelector('main')?.getBoundingClientRect().toJSON() ?? null,
          }));
          assert.deepEqual(layout.links, paths, `${path} desktop menu`);
          assert.deepEqual(layout.mobile, paths, `${path} mobile menu`);
          assert.ok(layout.documentWidth <= width + 1, `${path} horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
          assert.ok(layout.main && layout.main.left >= -1 && layout.main.right <= width + 1,
            `${path} main area clipped at ${width}: ${JSON.stringify(layout)}`);
          if (path === '/') await page.waitForFunction(() => getComputedStyle(document.getElementById('splashScreen')).opacity === '0');
          await page.screenshot({ path: join(artifacts, `${path === '/' ? 'home' : path.slice(1)}-${width}.png`) });
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

test('public login dialog has no internal work notices and fits mobile and desktop',
  { skip: !base, timeout: 90_000 }, async () => {
    await mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
        await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
        await page.goto(new URL('/', base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('body.is-ready').waitFor();
        await page.locator('.auth-btn-login').first().click();
        const modal = page.locator('#authModal.is-open');
        await modal.waitFor();
        assert.doesNotMatch(await modal.innerText(), /로그인 후 이어갈 작업|계정 상태 안내|이메일 로그인 대안/);
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('#authModal .auth-modal')?.getBoundingClientRect();
          return { panel: panel?.toJSON(), viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
        });
        assert.ok(layout.panel && layout.panel.left >= -1 && layout.panel.right <= width + 1,
          `Login panel clipped at ${width}: ${JSON.stringify(layout)}`);
        assert.ok(layout.documentWidth <= width + 1, `Login dialog overflows at ${width}`);
        await page.screenshot({ path: join(artifacts, `login-${width}.png`) });
        await page.locator('#authModal [data-tab="register"]').click();
        await page.locator('#authModal [data-form="register"]').waitFor({ state: 'visible' });
        assert.ok(await page.locator('#authModal .auth-modal-close').isVisible());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: join(artifacts, `register-${width}.png`) });
        const lastProvider = page.locator('#authSocialButtons .auth-social-btn').last();
        if (await lastProvider.count()) {
          await lastProvider.scrollIntoViewIfNeeded();
          const button = await lastProvider.boundingBox();
          assert.ok(button && button.y >= 0 && button.y + button.height <= 844,
            `Last social login button is not reachable at ${width}: ${JSON.stringify(button)}`);
        }
        await page.locator('#authModal [data-tab="login"]').click();
        await page.locator('#authModal [data-switch="forgot"]').click();
        await page.locator('#authModal [data-form="forgot"]').waitFor({ state: 'visible' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: join(artifacts, `forgot-${width}.png`) });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

test('published artist profiles keep portrait, facts and layout across viewport sizes',
  { skip: !base, timeout: 180_000 }, async () => {
    await mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
        await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
        for (const slug of ['yoon-serin', 'kang-sia', 'oh-hyerin']) {
          const response = await page.goto(new URL(`/character-detail?slug=${slug}`, base).href,
            { waitUntil: 'domcontentloaded', timeout: 30_000 });
          assert.equal(response?.status(), 200, `${slug} page status`);
          await page.locator('#detailIntro h1').waitFor({ timeout: 20_000 });
          await page.waitForFunction(() => document.querySelector('#detailHero img')?.naturalWidth > 0,
            undefined, { timeout: 20_000 });
          await page.locator('#detailHero img').evaluate(image => image.decode());
          const layout = await page.evaluate(() => ({
            title: document.querySelector('#detailIntro h1')?.textContent?.trim(),
            profileCount: document.querySelectorAll('#detailProfile > div').length,
            portrait: document.querySelector('#detailHero img')?.naturalWidth || 0,
            imageRect: document.querySelector('#detailHero img')?.getBoundingClientRect().toJSON(),
            frameRect: document.querySelector('#detailHero .detail-hero-frame')?.getBoundingClientRect().toJSON(),
            imageOpacity: getComputedStyle(document.querySelector('#detailHero img')).opacity,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
          }));
          assert.ok(layout.title && layout.profileCount > 0 && layout.portrait > 0,
            `${slug} incomplete public profile: ${JSON.stringify(layout)}`);
          assert.ok(layout.documentWidth <= width + 1,
            `${slug} profile overflows at ${width}: ${JSON.stringify(layout)}`);
          assert.ok(layout.imageRect?.height >= layout.frameRect?.height * 0.95,
            `${slug} portrait does not fill frame: ${JSON.stringify(layout)}`);
          assert.equal(layout.imageOpacity, '1', `${slug} portrait is transparent`);
          if (slug === 'oh-hyerin') {
            assert.equal(await page.locator('#detailGallery').isVisible(), true);
            await page.waitForFunction(() => document.querySelector('#detailGallery img')?.naturalWidth > 0,
              undefined, { timeout: 20_000 });
          }
          await page.screenshot({ path: join(artifacts, `artist-${slug}-${width}.png`) });
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

test('every active public artist has a readable desktop/mobile profile and loaded portrait',
  { skip: !base, timeout: 300_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      const response = await page.request.get('https://api.lumina-stage.com/api/v1/artists');
      assert.equal(response.ok(), true);
      const artists = await response.json();
      assert.equal(Array.isArray(artists), true);
      const active = artists.filter((artist) => artist.status === 'active' && artist.slug);
      assert.ok(active.length > 0);
      const failures = [];
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const artist of active) {
          try {
            const result = await page.goto(new URL(`/character-detail?slug=${encodeURIComponent(artist.slug)}`, base).href,
              { waitUntil: 'domcontentloaded', timeout: 20_000 });
            assert.equal(result?.status(), 200);
            await page.locator('#detailIntro h1').waitFor({ timeout: 15_000 });
            await page.waitForFunction(() => document.querySelector('#detailHero img')?.naturalWidth > 0,
              null, { timeout: 15_000 });
            const layout = await page.evaluate(() => ({
              title: document.querySelector('#detailIntro h1')?.textContent?.trim(),
              profileCount: document.querySelectorAll('#detailProfile > div').length,
              portraitWidth: document.querySelector('#detailHero img')?.naturalWidth || 0,
              opacity: getComputedStyle(document.querySelector('#detailHero img')).opacity,
              pageWidth: document.documentElement.scrollWidth,
              viewportWidth: innerWidth,
            }));
            assert.ok(layout.title && layout.profileCount > 0 && layout.portraitWidth > 0 &&
              layout.opacity === '1' && layout.pageWidth <= layout.viewportWidth + 1,
            JSON.stringify(layout));
          } catch (error) {
            failures.push(`${artist.slug} ${width}px: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      assert.deepEqual(failures, []);
      await page.close();
    } finally {
      await browser.close();
    }
  });

test('active artist galleries render every slide on mobile',
  { skip: !base, timeout: 300_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(/googletagmanager|google-analytics|doubleclick/, route => route.abort());
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      const response = await page.request.get('https://api.lumina-stage.com/api/v1/artists');
      assert.equal(response.ok(), true);
      const active = (await response.json()).filter(artist => artist.status === 'active' && artist.slug);
      assert.ok(active.length > 0);
      const failures = [];
      for (const artist of active) {
        try {
          await page.goto(new URL(`/character-detail?slug=${encodeURIComponent(artist.slug)}`, base).href,
            { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await page.waitForFunction(() => document.querySelectorAll('#galleryTrack .gallery-slide').length > 0,
            null, { timeout: 15_000 });
          const count = await page.locator('#galleryTrack .gallery-slide').count();
          for (let step = 0; step < Math.ceil(count / 4); step++) {
            await page.waitForFunction(({ start, end }) => {
              const images = [...document.querySelectorAll('#galleryTrack .gallery-slide img')].slice(start, end);
              return images.length === end - start && images.every(image => image.complete && image.naturalWidth > 0);
            }, { start: step * 4, end: Math.min(count, (step + 1) * 4) }, { timeout: 15_000 });
            if (step === Math.ceil(count / 4) - 1) break;
            const previousCounter = await page.locator('#galleryCounter').innerText();
            await page.locator('#galleryNext').click();
            await page.waitForFunction(previous => document.querySelector('#galleryCounter')?.textContent !== previous,
              previousCounter, { timeout: 8_000 });
          }
          assert.equal(await page.locator('#galleryNext').isEnabled(), false, `${artist.slug} final page`);
        } catch (error) {
          failures.push(`${artist.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      assert.deepEqual(failures, []);
      await page.close();
    } finally {
      await browser.close();
    }
  });

test('home and artist catalog list every active public artist',
  { skip: !base, timeout: 120_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.route(/googletagmanager|google-analytics|doubleclick/, route => route.abort());
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      const response = await page.request.get('https://api.lumina-stage.com/api/v1/artists');
      assert.equal(response.ok(), true);
      const expected = (await response.json()).filter(artist => artist.status === 'active' && artist.slug)
        .map(artist => artist.slug).sort();
      assert.ok(expected.length > 0);
      for (const [path, selector] of [['/', '#mainArtistGrid .artist-card'],
        ['/characters', '#characterCatalog .catalog-card']]) {
        await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length >= count,
          { selector, count: expected.length }, { timeout: 25_000 });
        const actual = await page.locator(selector).evaluateAll(cards => cards.map(card => {
          const link = card.querySelector('a[href*="slug="]');
          return link ? new URL(link.href).searchParams.get('slug') : null;
        }).filter(Boolean).sort());
        assert.deepEqual(actual, expected, `${path} active lineup`);
      }
      await page.close();
    } finally {
      await browser.close();
    }
  });

test('public mobile navigation stays within the viewport in all five locales',
  { skip: !base, timeout: 180_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const issues = [];
      for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
        await page.addInitScript(value => {
          sessionStorage.setItem('ls_splashed', '1');
          localStorage.setItem('lumina_locale', value);
        }, locale);
        for (const path of paths) {
          await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          try {
            await page.locator('body.is-ready').waitFor({ timeout: 15_000 });
          } catch (error) {
            await mkdir(artifacts, { recursive: true });
            await page.screenshot({ path: join(artifacts, `${path === '/' ? 'home' : path.slice(1)}-${locale}-not-ready.png`) });
            throw new Error(`${path} ${locale} did not become ready: ${error.message}`, { cause: error });
          }
          if (loadedContent[path]) await page.locator(loadedContent[path]).first().waitFor({ timeout: 20_000 });
          const layout = await page.evaluate(() => ({
            lang: document.documentElement.lang,
            width: document.documentElement.scrollWidth,
            nav: [...document.querySelectorAll('.mobile-tabbar > a span')].map(el => el.textContent.trim()),
          }));
          if (layout.lang !== locale) issues.push(`${path} ${locale} document language: ${layout.lang}`);
          if (layout.width > 391) issues.push(`${path} ${locale} horizontal overflow: ${layout.width}px`);
          if (layout.nav.length !== 6 || !layout.nav.every(Boolean)) {
            issues.push(`${path} ${locale} navigation labels: ${JSON.stringify(layout.nav)}`);
          }
        }
        await page.close();
      }
      assert.deepEqual(issues, []);
    } finally {
      await browser.close();
    }
  });

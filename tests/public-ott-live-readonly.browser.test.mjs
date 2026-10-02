import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.LUMINA_LIVE_QA_URL;
const artifacts = process.env.LUMINA_LIVE_QA_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-ott-live-readonly-20260928';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

test('public choice theater connects each available branch on mobile without writing user data',
  { skip: !base, timeout: 180_000 }, async () => {
    await mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      const response = await page.goto(new URL('/ott', base).href, { waitUntil: 'domcontentloaded' });
      assert.equal(response?.status(), 200);
      await page.locator('body.is-ready').waitFor();
      for (const work of [
        { key: 'mother', choices: { embrace: '02-branch-embrace-original.mp4',
          ignore: '03-branch-ignore.mp4', hesitate: '04-branch-daughter-resists-final.mp4' } },
        { key: 'joker', choices: { embrace: '02-original-ending.mp4', ignore: '03-alternate-ending.mp4' } },
      ]) {
        await page.locator(`[data-ott-demo="${work.key}"]`).click();
        await page.waitForFunction(() => document.querySelector('#ottDemoVideo')?.duration > 0,
          null, { timeout: 30_000 });
        await page.locator('#ottToggleFullscreen').click();
        await page.locator('#ottDemoVideo').evaluate((video) => {
          video.currentTime = Math.max(0, video.duration - 0.8);
          void video.play().catch(() => {});
        });
        await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForFunction((count) =>
          [...document.querySelectorAll('#ottChoiceOverlay [data-ott-branch]')]
            .filter((button) => !button.disabled).length === count,
        Object.keys(work.choices).length, { timeout: 20_000 });
        const bounds = await page.locator('#ottChoiceOverlay [data-ott-branch]:not([disabled])')
          .evaluateAll((buttons) => buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              width: innerWidth, height: innerHeight };
          }));
        assert.ok(bounds.every((box) => box.left >= -1 && box.right <= box.width + 1 &&
          box.top >= -1 && box.bottom <= box.height + 1), `${work.key} choices clipped: ${JSON.stringify(bounds)}`);
        await page.screenshot({ path: join(artifacts, `${work.key}-choices-390.png`) });
        for (const [branch, filename] of Object.entries(work.choices)) {
          await page.locator(`[data-ott-branch="${branch}"]`).click();
          await page.waitForFunction((expected) => document.querySelector('#ottDemoVideo')?.currentSrc.includes(expected),
            filename, { timeout: 15_000 });
          await page.waitForFunction(() => document.querySelector('#ottDemoVideo')?.duration > 0,
            null, { timeout: 30_000 });
          assert.equal(await page.locator('#ottVideoError').isVisible(), false);
          await page.locator('#ottDemoVideo').evaluate((video) => {
            video.currentTime = Math.max(0, video.duration - 0.2);
            void video.play().catch(() => {});
          });
          await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20_000 });
        }
        await page.locator('#ottFullscreenExit').click();
        await page.locator('#ottBackToList').click();
      }
      await page.close();
    } finally {
      await browser.close();
    }
  });

test('public choice theater keeps all three choices reachable in mobile landscape fullscreen',
  { skip: !base, timeout: 120_000 }, async () => {
    await mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true,
        hasTouch: true });
      await page.route(/googletagmanager|google-analytics|doubleclick/, (route) => route.abort());
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      const response = await page.goto(new URL('/ott', base).href, { waitUntil: 'domcontentloaded' });
      assert.equal(response?.status(), 200);
      await page.locator('body.is-ready').waitFor();
      await page.locator('[data-ott-demo="mother"]').click();
      await page.waitForFunction(() => document.querySelector('#ottDemoVideo')?.duration > 0,
        null, { timeout: 30_000 });
      await page.locator('#ottToggleFullscreen').click();
      await page.locator('#ottDemoVideo').evaluate((video) => {
        video.currentTime = Math.max(0, video.duration - 0.8);
        void video.play().catch(() => {});
      });
      await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20_000 });
      const choices = page.locator('#ottChoiceOverlay [data-ott-branch]:not([disabled])');
      assert.equal(await choices.count(), 3);
      const bounds = await choices.evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: innerWidth, height: innerHeight };
      }));
      assert.ok(bounds.every((box) => box.left >= -1 && box.right <= box.width + 1 &&
        box.top >= -1 && box.bottom <= box.height + 1), JSON.stringify(bounds));
      await page.screenshot({ path: join(artifacts, 'mother-choices-landscape-844x390.png') });
      await page.locator('[data-ott-branch="ignore"]').click();
      await page.waitForFunction(() => document.querySelector('#ottDemoVideo')?.currentSrc.includes('03-branch-ignore.mp4'),
        null, { timeout: 15_000 });
      assert.equal(await page.locator('#ottVideoError').isVisible(), false);
      await page.close();
    } finally {
      await browser.close();
    }
  });

test('public choice overlay remains translated and unclipped in five mobile locales',
  { skip: !base, timeout: 240_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : {}) });
    try {
      const expected = [
        ['ko-KR', '돌아가 아이를 안아준다'],
        ['en-US', 'Go back and hold her child'],
        ['ja-JP', '戻って子どもを抱きしめる'],
        ['zh-CN', '回去拥抱孩子'],
        ['zh-Hant', '回去擁抱孩子'],
      ];
      for (const [locale, label] of expected) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.route(/googletagmanager|google-analytics|doubleclick/, route => route.abort());
        await page.addInitScript(value => {
          sessionStorage.setItem('ls_splashed', '1');
          localStorage.setItem('lumina_locale', value);
        }, locale);
        await page.goto(new URL('/ott', base).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.locator('body.is-ready').waitFor();
        await page.locator('[data-ott-demo="mother"]').click();
        await page.waitForFunction(() => document.querySelector('#ottDemoVideo')?.duration > 0,
          null, { timeout: 30_000 });
        await page.locator('#ottToggleFullscreen').click();
        await page.locator('#ottDemoVideo').evaluate(video => {
          video.currentTime = Math.max(0, video.duration - 0.8);
          void video.play().catch(() => {});
        });
        await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20_000 });
        assert.equal(await page.locator('#ottChoiceEmbrace').innerText(), label);
        const bounds = await page.locator('#ottChoiceOverlay [data-ott-branch]:not([disabled])')
          .evaluateAll(buttons => buttons.map(button => {
            const box = button.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: innerWidth, height: innerHeight };
          }));
        assert.equal(bounds.length, 3, `${locale} enabled choices`);
        assert.ok(bounds.every(box => box.left >= -1 && box.right <= box.width + 1 &&
          box.top >= -1 && box.bottom <= box.height + 1), `${locale} choices clipped: ${JSON.stringify(bounds)}`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.FEED_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-feed-20261001';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const viewerId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const otherViewerId = '33333333-3333-4333-8333-333333333333';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const post = {
  id: 'block-target-post', postType: 'fan_post', authorType: 'fan', authorName: 'Test Fan',
  authorUserId: targetId, authorPublicHandle: 'test-target', body: 'Block boundary test post.',
  viewer: { isMine: false, isFollowingAuthor: true },
};

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

async function preparePage(browser, base, width, locale) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 800 } });
  const page = await context.newPage();
  const state = { blocked: false, failReload: false, cancel: false, requests: [], dialogs: [], errors: [], heldList: null, heldDetail: null };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('dialog', async dialog => {
    state.dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'confirm' && state.cancel) await dialog.dismiss();
    else await dialog.accept();
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    state.requests.push({ method: request.method(), path: url.pathname });
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/v1/me/settings') return reply({});
    if (url.pathname === `/api/v1/users/${targetId}/block` && request.method() === 'POST') {
      state.blocked = true;
      return reply({ block: { status: 'active', user: { id: targetId, publicHandle: 'test-target' } } });
    }
    if (url.pathname === '/api/v1/me/lumina-feed') {
      if (state.heldList) {
        const release = state.heldList;
        state.heldList = null;
        state.listStarted?.();
        await release;
        return reply({ items: [post] });
      }
      if (request.headers().authorization === 'Bearer other-viewer-fixture') {
        return reply({ items: [{ ...post, id: 'other-account-post', body: 'Other account current feed.' }] });
      }
      if (state.blocked && state.failReload) return reply({ message: 'private failure detail' }, 503);
      return reply({ items: state.blocked ? [] : [post] });
    }
    if (url.pathname === '/api/v1/lumina-feed') return reply({ items: [post] });
    if (url.pathname === '/api/v1/lumina-feed/posts/slow-detail' && state.heldDetail) {
      const release = state.heldDetail;
      state.heldDetail = null;
      state.detailStarted?.();
      await release;
      return reply({ post: { ...post, id: 'slow-detail', body: 'Old detail must not return.' } });
    }
    return reply({ items: [] });
  });
  await page.addInitScript(({ locale, viewerId }) => {
    sessionStorage.setItem('ls_splashed', '1');
    localStorage.setItem('lumina_locale', locale);
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'viewer-fixture', user: { id: viewerId, displayName: 'Test Viewer' } }));
  }, { locale, viewerId });
  await page.goto(`${base}/lumina-feed`, { waitUntil: 'domcontentloaded' });
  await page.locator('body.is-ready').waitFor();
  await page.locator('.feed-post .feed-block-btn').waitFor();
  return { page, context, state };
}

async function checkGeometry(page, width) {
  const geometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll('.feed-block-btn')].filter(element => element.getBoundingClientRect().width > 0).map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }),
  }));
  assert.ok(geometry.documentWidth <= width + 1, JSON.stringify(geometry));
  for (const button of geometry.buttons) {
    assert.ok(button.left >= 0 && button.right <= width + 1 && button.width > 0 && button.height > 0, JSON.stringify(button));
  }
}

test('actual feed list/detail block controls work in five locales on desktop and mobile', { timeout: 180_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://feed.qa.test:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP feed.qa.test 127.0.0.1', '--no-proxy-server'], ...(executablePath ? { executablePath } : {}) });
    for (const width of [1280, 390]) {
      for (const locale of ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant']) {
        const { page, context, state } = await preparePage(browser, base, width, locale);
        try {
          const labels = await page.evaluate(() => ({
            label: window.luminaI18n.t('feed.block.label'),
            confirm: window.luminaI18n.t('feed.block.confirm').replace('{name}', 'Test Fan'),
            success: window.luminaI18n.t('feed.block.success'),
          }));
          assert.equal(await page.locator('.feed-post .feed-block-btn').textContent().then(text => text.trim()), labels.label);
          state.cancel = true;
          await page.locator('.feed-post .feed-block-btn').click();
          assert.equal(state.dialogs.at(-1).message, labels.confirm);
          assert.equal(state.requests.filter(entry => entry.method === 'POST').length, 0);
          assert.equal(await page.locator('.feed-post').count(), 1);
          await page.evaluate(() => window.openFeedPostDetail('block-target-post'));
          await page.locator('#feedPostDetail .feed-block-btn').waitFor();
          assert.equal(await page.locator('.feed-list').isVisible(), false);
          assert.equal(await page.locator('#feedCompose').isVisible(), false);
          await page.locator('#feedDetailBackBtn').scrollIntoViewIfNeeded();
          await checkGeometry(page, width);
          if (locale === 'ko-KR') await page.screenshot({ path: join(artifacts, `block-detail-${width}.png`), fullPage: false });
          state.cancel = false;
          await page.locator('#feedPostDetail .feed-block-btn').click();
          await page.waitForFunction(() => document.querySelectorAll('.feed-post').length === 0 && !!document.querySelector('.feed-empty'));
          await page.waitForFunction(() => document.querySelector('#feedPostDetail')?.hidden === true);
          await page.waitForTimeout(50);
          assert.equal(state.dialogs.at(-1).message, labels.success);
          assert.equal(state.requests.filter(entry => entry.method === 'POST').length, 1);
          assert.equal(state.requests.some(entry => entry.path === '/api/v1/lumina-feed'), false);
          assert.deepEqual(state.errors, []);
          if (locale === 'ko-KR') await page.screenshot({ path: join(artifacts, `block-empty-${width}.png`), fullPage: false });
        } finally {
          await context.close();
        }
      }
    }
    const { page, context, state } = await preparePage(browser, base, 400, 'ko-KR');
    try {
      state.failReload = true;
      await page.locator('.feed-post .feed-block-btn').click();
      await page.waitForFunction(() => document.querySelector('.feed-empty')?.textContent === window.luminaI18n.t('feed.empty.error'));
      await page.waitForTimeout(50);
      assert.equal(state.dialogs.at(-1).message, await page.evaluate(() => window.luminaI18n.t('feed.block.refreshError')));
      assert.equal(state.requests.some(entry => entry.path === '/api/v1/lumina-feed'), false);
      assert.equal(await page.locator('.feed-post').count(), 0);
      await checkGeometry(page, 400);
      await page.screenshot({ path: join(artifacts, 'block-refresh-error-400.png'), fullPage: false });
      assert.deepEqual(state.errors, []);
    } finally { await context.close(); }

    const account = await preparePage(browser, base, 1280, 'ko-KR');
    let releaseList;
    let releaseDetail;
    try {
      account.state.heldList = new Promise(resolve => { releaseList = resolve; });
      const listStarted = new Promise(resolve => { account.state.listStarted = resolve; });
      await account.page.evaluate(() => { void window.loadLuminaFeedData().then(window.renderLuminaFeed); });
      await listStarted;
      account.state.heldDetail = new Promise(resolve => { releaseDetail = resolve; });
      const detailStarted = new Promise(resolve => { account.state.detailStarted = resolve; });
      await account.page.evaluate(() => { void window.openFeedPostDetail('slow-detail'); });
      await detailStarted;
      await account.page.evaluate(id => setAuth({ accessToken: 'other-viewer-fixture', user: { id, displayName: 'Other Viewer' } }), otherViewerId);
      await account.page.waitForFunction(() => document.querySelector('.feed-post')?.textContent.includes('Other account current feed.'));
      releaseList();
      releaseDetail();
      await account.page.waitForTimeout(150);
      assert.equal(await account.page.locator('.feed-post').count(), 1);
      assert.equal(await account.page.locator('.feed-post').innerText().then(text => text.includes('Block boundary test post.')), false);
      assert.equal(await account.page.locator('body').innerText().then(text => text.includes('Old detail must not return.')), false);
      assert.deepEqual(account.state.errors, []);
    } finally {
      releaseList?.(); releaseDetail?.();
      await account.context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

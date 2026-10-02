import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.FEED_UI_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.FEED_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-feed-20260928';
const browserExecutable = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];
const widths = [1280, 390, 400];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const posts = [
  { id: 'feed-artist', postType: 'artist_post', artistSlug: 'yoon-serin', authorType: 'AI 아티스트', body: '오늘의 연습을 마쳤습니다.', likeCount: 3 },
  { id: 'feed-fan', postType: 'fan_post', authorType: '팬', authorName: 'QA 팬', body: '좋은 무대였어요.', likeCount: 2 },
];

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

async function installInterceptors(page, base, requests, fixture) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    requests.push({ method: request.method(), path: url.pathname, query: url.search });
    if (url.pathname === '/api/v1/me/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url.pathname === '/api/v1/me/lumina-feed' || url.pathname === '/api/v1/lumina-feed') {
      if (fixture.failFeed) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: posts }) });
    }
    if (url.pathname === '/api/v1/lumina-feed/search') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
    }
    if (url.pathname === '/api/v1/lumina-feed/posts' && request.method() === 'POST') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fixture server detail"}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
}

async function assertNoHorizontalClip(page, width, selectors) {
  const geometry = await page.evaluate((targets) => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    elements: targets.map((selector) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden || getComputedStyle(element).display === 'none') return { selector, hidden: true };
      const bounds = element.getBoundingClientRect();
      return { selector, left: bounds.left, right: bounds.right, width: bounds.width };
    }),
  }), selectors);
  assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `${width}px document overflow: ${JSON.stringify(geometry)}`);
  for (const element of geometry.elements) {
    if (element.hidden) continue;
    assert.ok(element.left >= -1 && element.right <= width + 1,
      `${width}px ${element.selector} clipped: ${JSON.stringify(element)}`);
  }
}

async function assertItemsVisibleWithinParent(page, selector, expectedCount) {
  const links = await page.locator(selector).evaluateAll((items) => {
    const parent = items[0]?.parentElement?.getBoundingClientRect();
    return items.map((item) => {
      const bounds = item.getBoundingClientRect();
      return { label: item.textContent.trim(), left: bounds.left, right: bounds.right, parentLeft: parent.left, parentRight: parent.right };
    });
  });
  assert.equal(links.length, expectedCount);
  for (const link of links) {
    assert.ok(link.left >= link.parentLeft - 1 && link.right <= link.parentRight + 1,
      `${selector} clipped: ${JSON.stringify(link)}`);
  }
}

test('feed compose, filters, empty/search/error states and five locales fit desktop and mobile', { timeout: 180_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://feed.qa.test:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--host-resolver-rules=MAP feed.qa.test 127.0.0.1', '--no-proxy-server'],
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    });
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      const requests = [];
      const fixture = { failFeed: false };
      await installInterceptors(page, base, requests, fixture);
      await page.addInitScript(() => {
        sessionStorage.setItem('ls_splashed', '1');
        localStorage.setItem('lumina_locale', 'ko-KR');
        localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'fixture-only', user: { id: 'qa-user', displayName: 'QA Writer' } }));
      });
      await page.goto(`${base}/lumina-feed`, { waitUntil: 'domcontentloaded' });
      await page.locator('body.is-ready').waitFor();
      await page.locator('.feed-post').first().waitFor();
      assert.equal(await page.locator('.feed-post').count(), 2);
      assert.equal(await page.locator('#feedCompose').isVisible(), true);
      assert.equal(await page.locator('#feedComposeGuest').isVisible(), false);
      assert.equal(await page.locator('.auth-btn-login').getAttribute('data-action'), 'menu');
      assert.equal(await page.locator('.auth-btn-login').textContent(), 'QA Writer');

      for (const locale of locales) {
        await page.evaluate((value) => window.luminaI18n.setLocale(value), locale);
        assert.equal(await page.locator('html').getAttribute('lang'), locale);
        assert.equal(await page.locator('.auth-btn-login').textContent(), 'QA Writer');
        assert.equal(await page.locator('.auth-btn-signup').textContent(),
          await page.evaluate(() => window.luminaI18n.t('auth.logout')));
        const labels = await page.evaluate(() => ({
          filter: window.luminaI18n.t('feed.filter.artist'),
          submit: window.luminaI18n.t('feed.compose.submit'),
          placeholder: window.luminaI18n.t('feed.compose.placeholder'),
          filterEmpty: window.luminaI18n.t('feed.empty.filter'),
          searchEmpty: window.luminaI18n.t('feed.empty.search'),
          loadError: window.luminaI18n.t('feed.empty.error'),
          submitError: window.luminaI18n.t('feed.compose.error.server'),
        }));
        assert.equal(await page.locator('[data-feed-filter="artist_post"]').innerText(), labels.filter);
        assert.equal(await page.locator('#feedComposeSubmit').innerText(), labels.submit);
        assert.equal(await page.locator('#feedComposeText').getAttribute('placeholder'), labels.placeholder);
        if (locale !== locales[0]) {
          assert.equal(await page.locator('#feedComposeMessage').innerText(), labels.submitError);
        }
        await assertItemsVisibleWithinParent(page, '.feed-side-nav a', 5);
        await assertItemsVisibleWithinParent(page, '.feed-tabs .feed-tab', 5);
        await assertNoHorizontalClip(page, width, ['.feed-shell', '.feed-main-column', '.feed-compose', '.feed-post']);
        await page.screenshot({ path: join(artifacts, `feed-${width}-${locale}.png`), fullPage: false });

        await page.locator('[data-feed-filter="debut_artist_post"]').click();
        assert.equal(await page.locator('.feed-empty').innerText(), labels.filterEmpty);
        await assertNoHorizontalClip(page, width, ['.feed-shell', '.feed-main-column', '.feed-empty']);
        await page.screenshot({ path: join(artifacts, `feed-filter-empty-${width}-${locale}.png`), fullPage: true });
        await page.locator('[data-feed-filter="all"]').click();
        await page.locator('.feed-post').first().waitFor();

        await page.locator('#feedSearchInput').fill('not-found-fixture');
        await page.waitForFunction(() => document.querySelector('.feed-empty')?.textContent === window.luminaI18n.t('feed.empty.search'));
        assert.equal(await page.locator('.feed-empty').innerText(), labels.searchEmpty);
        await page.screenshot({ path: join(artifacts, `feed-search-empty-${width}-${locale}.png`), fullPage: true });
        await page.locator('#feedSearchInput').fill('');
        await page.evaluate(async () => { await window.loadLuminaFeedData(); window.renderLuminaFeed(); });
        assert.equal(await page.locator('.feed-post').count(), 2);

        fixture.failFeed = true;
        await page.evaluate(async () => { await window.loadLuminaFeedData(); window.renderLuminaFeed(); });
        assert.equal(await page.locator('.feed-empty').innerText(), labels.loadError);
        await assertNoHorizontalClip(page, width, ['.feed-shell', '.feed-main-column', '.feed-empty']);
        await page.screenshot({ path: join(artifacts, `feed-error-${width}-${locale}.png`), fullPage: true });
        fixture.failFeed = false;
        await page.evaluate(async () => { await window.loadLuminaFeedData(); window.renderLuminaFeed(); });
        assert.equal(await page.locator('.feed-post').count(), 2);

        await page.locator('#feedComposeText').fill(`QA ${locale}`);
        await page.locator('#feedComposeSubmit').click();
        await page.waitForFunction(() => document.querySelector('#feedComposeMessage')?.textContent === window.luminaI18n.t('feed.compose.error.server'));
        await page.waitForFunction(() => document.querySelector('#feedComposeSubmit')?.textContent === window.luminaI18n.t('feed.compose.submit'));
        assert.equal(await page.locator('#feedComposeMessage').innerText(), labels.submitError);
        assert.equal(await page.locator('#feedComposeText').inputValue(), `QA ${locale}`);
        assert.equal(await page.locator('#feedComposeSubmit').innerText(), labels.submit);
        await assertNoHorizontalClip(page, width, ['.feed-shell', '.feed-main-column', '.feed-compose', '.feed-post']);
        await page.screenshot({ path: join(artifacts, `feed-compose-error-${width}-${locale}.png`), fullPage: true });
        await page.locator('#feedComposeText').fill('');
      }
      assert.equal(requests.filter((entry) => entry.method === 'POST').length, locales.length);
      assert.equal(requests.some((entry) => entry.method !== 'GET' && entry.method !== 'PATCH' && entry.path !== '/api/v1/lumina-feed/posts'), false);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function withDiscoveryBrowser(run, secureLoopback = false) {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://${secureLoopback ? '127.0.0.1' : 'feed.qa.test'}:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      args: ['--host-resolver-rules=MAP feed.qa.test 127.0.0.1', '--no-proxy-server'],
      ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    await run(browser, base);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function discoveryPage(browser, base, width, handle) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/trending-searches') || url.pathname.endsWith('/hashtags') || url.pathname.endsWith('/search')) {
      return handle(url, reply, route.request());
    }
    return reply({ items: [] });
  });
  await page.addInitScript(() => { sessionStorage.setItem('ls_splashed', '1'); localStorage.setItem('lumina_locale', 'ko-KR'); });
  return page;
}

test('discovery ignores late locale responses and fits five localized states on PC and mobile', { timeout: 90_000 }, async () => {
  await withDiscoveryBrowser(async (browser, base) => {
    for (const width of [390, 1280]) {
      let release;
      let markStarted;
      const started = new Promise(resolve => { markStarted = resolve; });
      const requests = [];
      let holdFirst = true;
      const page = await discoveryPage(browser, base, width, async (url, reply, request) => {
        const language = url.searchParams.get('language');
        requests.push({ path: url.pathname, language, method: request.method() });
        if (url.pathname.endsWith('/trending-searches') && holdFirst) {
          holdFirst = false;
          await new Promise(resolve => { release = resolve; markStarted(); });
          return reply({ items: [{ keyword: 'OLD_KO_DO_NOT_RESTORE', searchCount: 99 }] });
        }
        const keyword = url.pathname.endsWith('/hashtags') ? `#TAG_${language}` : `CURRENT_${language}`;
        return reply({ items: [{ keyword, searchCount: 1234 }] });
      });
      try {
        await page.goto(`${base}/lumina-feed`, { waitUntil: 'domcontentloaded' });
        await started;
        await page.evaluate(() => { window.__firstDiscovery = window.initLuminaFeedDiscovery(); window.luminaI18n.setLocale('en-US'); });
        await page.waitForFunction(() => document.getElementById('feedTrendList')?.textContent.includes('CURRENT_en'));
        release();
        await page.evaluate(() => window.__firstDiscovery);
        assert.doesNotMatch(await page.locator('#feedTrendList').textContent(), /OLD_KO/);
        for (const locale of locales) {
          await page.evaluate(value => window.luminaI18n.setLocale(value), locale);
          await page.evaluate(() => window.initLuminaFeedDiscovery());
          assert.equal(await page.locator('#feedTrendLocaleLabel').textContent(), await page.evaluate(() => window.luminaI18n.t('feed.discovery.locale')));
          assert.equal(await page.locator('#feedTrendList').getAttribute('data-state'), 'ready');
          assert.equal(await page.locator('#feedHashtagList').getAttribute('aria-busy'), 'false');
          const prefix = await page.evaluate(() => window.luminaI18n.t('feed.discovery.checkedAt').split('{time}')[0]);
          assert.ok((await page.locator('#feedTrendStatus').textContent()).startsWith(prefix));
          await page.locator('.feed-trend-panel').scrollIntoViewIfNeeded();
          await assertNoHorizontalClip(page, width, ['.feed-trend-panel', '#feedTrendList', '#feedTrendStatus', '#feedHashtagStatus']);
          const fits = await page.locator('.feed-discovery-status').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1));
          assert.equal(fits, true);
          await page.locator('.feed-trend-panel').screenshot({ path: join(artifacts, `feed-discovery-${width}-${locale}.png`) });
        }
        assert.ok(requests.every(request => request.method === 'GET'));
        assert.ok(requests.every(request => request.language !== 'all'), 'nonempty language results never fall back');
      } finally { release?.(); await page.close(); }
    }
  });
});

test('discovery refreshes while visible, labels fallback, and replaces failures without stale keywords', { timeout: 90_000 }, async () => {
  await withDiscoveryBrowser(async (browser, base) => {
    const requests = [];
    const state = { version: 'FIRST', fail: false };
    const page = await discoveryPage(browser, base, 400, async (url, reply, request) => {
      requests.push({ path: url.pathname, language: url.searchParams.get('language'), query: url.searchParams.get('q'), method: request.method() });
      if (url.pathname.endsWith('/search')) return reply({ items: [] });
      if (url.pathname.endsWith('/trending-searches')) {
        if (state.fail) return reply({ message: 'PRIVATE_SERVER_DETAIL' }, 503);
        return reply({ items: url.searchParams.get('language') === 'all' ? [{ keyword: `${state.version}_ALL`, searchCount: 3 }] : [] });
      }
      return reply({ items: [{ keyword: `#${state.version}_TAG`, postCount: 2 }] });
    });
    try {
      await page.clock.install({ time: new Date('2026-10-01T06:00:00.000Z') });
      await page.goto(`${base}/lumina-feed`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('feedTrendList')?.textContent.includes('FIRST_ALL'));
      assert.match(await page.locator('#feedTrendStatus').textContent(), /전체 언어/);
      assert.doesNotMatch(await page.locator('#feedHashtagStatus').textContent(), /전체 언어/);
      state.version = 'SECOND';
      await page.clock.fastForward(5 * 60 * 1000);
      await page.waitForFunction(() => document.getElementById('feedTrendList')?.textContent.includes('SECOND_ALL'));
      const count = requests.length;
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
      state.version = 'THIRD';
      await page.clock.fastForward(5 * 60 * 1000);
      assert.equal(requests.length, count, 'hidden tabs do not poll');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.getElementById('feedTrendList')?.textContent.includes('THIRD_ALL'));
      state.fail = true;
      const beforeFailure = requests.length;
      await page.evaluate(() => window.initLuminaFeedDiscovery());
      assert.equal(await page.locator('#feedTrendList').getAttribute('data-state'), 'error');
      assert.equal(await page.locator('#feedHashtagList').getAttribute('data-state'), 'ready');
      assert.equal(await page.locator('#feedTrendStatus').textContent(), '');
      assert.match(await page.locator('#feedTrendList').textContent(), /불러오지 못했어요/);
      assert.doesNotMatch(await page.locator('#feedTrendList').textContent(), /FIRST|SECOND|THIRD|PRIVATE_SERVER_DETAIL/);
      assert.equal(requests.slice(beforeFailure).filter(request => request.language === 'all').length, 0, 'HTTP errors never fall back');
      await page.locator('#feedHashtagList [data-feed-search-keyword]').click();
      await page.waitForFunction(() => document.querySelector('.feed-empty')?.textContent === window.luminaI18n.t('feed.empty.search'));
      assert.equal(requests.at(-1).query, '#THIRD_TAG');
      assert.ok(requests.every(request => request.method === 'GET'));
      await page.locator('.feed-trend-panel').screenshot({ path: join(artifacts, 'feed-discovery-400-error.png') });
    } finally { await page.close(); }
  });
});

const reportViewer = '11111111-1111-4111-8111-111111111111';
const reportPostId = '22222222-2222-4222-8222-222222222222';
const receiptId = '33333333-3333-4333-8333-333333333333';

async function reportPage(browser, base, width, state) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith(`/${reportPostId}/report`)) {
      state.writes.push(request.postDataJSON());
      const mode = state.mode;
      if (mode === 'hold') await new Promise(resolve => { state.release = resolve; state.started?.(); });
      if (mode === 'fail') return reply({ message: 'PRIVATE_REPORT_ERROR' }, 503);
      return reply({ report: { id: receiptId, postId: mode === 'invalid' ? receiptId : reportPostId,
        reporterUserId: reportViewer, status: 'submitted' }, alreadySubmitted: mode === 'duplicate' });
    }
    if (url.pathname === '/api/v1/me/lumina-feed' || url.pathname === '/api/v1/lumina-feed') {
      return reply({ items: [{ id: reportPostId, postType: 'fan_post', authorName: 'Synthetic Fan',
        authorUserId: '44444444-4444-4444-8444-444444444444', authorPublicHandle: 'synthetic-fan',
        body: 'Synthetic public post for report tests.', viewer: { isMine: false } }] });
    }
    return reply({ items: [] });
  });
  await page.addInitScript(id => {
    sessionStorage.setItem('ls_splashed', '1');
    localStorage.setItem('lumina_locale', 'ko-KR');
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'report-fixture', user: { id, displayName: 'Synthetic Viewer' } }));
  }, reportViewer);
  await page.goto(`${base}/lumina-feed`, { waitUntil: 'domcontentloaded' });
  await page.locator('body.is-ready').waitFor();
  await page.locator('.feed-post [data-feed-report]:enabled').waitFor();
  return page;
}

test('report form validates, submits, restores focus and fits five locales on desktop and mobile', { timeout: 90_000 }, async () => {
  await withDiscoveryBrowser(async (browser, base) => {
    for (const width of [390, 400, 1280]) {
      const state = { mode: 'success', writes: [] };
      const page = await reportPage(browser, base, width, state);
      try {
        for (const locale of locales) {
          await page.evaluate(value => window.luminaI18n.setLocale(value), locale);
          await page.locator('.feed-post [data-feed-report]').click();
          const dialog = page.locator('.feed-report-dialog');
          await dialog.waitFor();
          assert.equal(await dialog.getAttribute('aria-labelledby'), 'feedReportHeading');
          assert.equal(await page.locator('#feedReportHeading').textContent(), await page.evaluate(() => window.luminaI18n.t('feed.report.title')));
          const count = state.writes.length;
          await dialog.locator('[type=submit]').click();
          assert.equal(state.writes.length, count, 'no selected reason means no POST');
          await page.locator('#feedReportReason').selectOption('spam');
          await page.locator('#feedReportDetail').fill('Synthetic additional detail.');
          await assertNoHorizontalClip(page, width, ['.feed-report-dialog', '#feedReportReason', '#feedReportDetail', '.feed-report-actions']);
          const geometry = await dialog.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const background = getComputedStyle(node).backgroundColor;
            return { top: rect.top, bottom: rect.bottom, height: innerHeight, overflow: node.scrollWidth > node.clientWidth + 1,
              backgroundAlpha: background.startsWith('rgba(') ? Number(background.split(',').at(-1).replace(')', '')) : background.startsWith('rgb(') ? 1 : 0,
              buttons: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
          });
          assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1 && !geometry.overflow, JSON.stringify(geometry));
          assert.equal(geometry.backgroundAlpha, 1, 'dialog content must not blend with the post behind it');
          assert.ok(geometry.buttons.every(height => height >= 44));
          await dialog.screenshot({ path: join(artifacts, `feed-report-${width}-${locale}.png`) });
          await dialog.locator('[type=submit]').click();
          if (state.writes.length === count) {
            const diagnosis = await page.evaluate(() => ({ secure: window.isSecureContext, uuid: typeof crypto.randomUUID,
              message: document.querySelector('[data-report-message]')?.textContent,
              reason: document.getElementById('feedReportReason')?.value, available: window.feedReportAvailable?.() }));
            assert.notEqual(diagnosis.message, await page.evaluate(() => window.luminaI18n.t('feed.report.error')), JSON.stringify(diagnosis));
          }
          await page.waitForFunction(() => document.querySelector('[data-report-message]')?.textContent === window.luminaI18n.t('feed.report.submitted'));
          assert.equal(state.writes.length, count + 1);
          assert.match(state.writes.at(-1).requestKey, /^[0-9a-f-]{36}$/i);
          assert.equal(state.writes.at(-1).reason, 'spam');
          assert.equal(await dialog.locator('[type=submit]').isVisible(), false);
          await dialog.locator('[data-report-cancel]').click();
          assert.equal(await dialog.count(), 0);
          assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-feed-report')), true);
        }
      } finally { await page.close(); }
    }
  }, true);
});

test('report retry keeps its key and late account/closed-dialog responses cannot reopen or replace the current view', { timeout: 90_000 }, async () => {
  await withDiscoveryBrowser(async (browser, base) => {
    const state = { mode: 'fail', writes: [] };
    const page = await reportPage(browser, base, 390, state);
    try {
      await page.locator('.feed-post [data-feed-report]').click();
      await page.locator('#feedReportReason').selectOption('spam');
      await page.locator('.feed-report-dialog [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-report-message]')?.textContent === window.luminaI18n.t('feed.report.error'));
      assert.doesNotMatch(await page.locator('.feed-report-dialog').textContent(), /PRIVATE_REPORT_ERROR/);
      assert.equal(await page.locator('.feed-report-dialog [type=submit]').isEnabled(), true);
      const firstKey = state.writes[0].requestKey;
      await page.locator('.feed-report-dialog [data-report-cancel]').click();
      await page.locator('.feed-post [data-feed-report]').click();
      await page.locator('#feedReportReason').selectOption('spam');
      state.mode = 'duplicate';
      await page.locator('.feed-report-dialog [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-report-message]')?.textContent === window.luminaI18n.t('feed.report.duplicate'));
      assert.equal(state.writes[1].requestKey, firstKey, 'close/reopen retry keeps the uncertain submission key');
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('lumina-feed-report:')).length), 0);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.feed-report-dialog').count(), 0);

      let markStarted;
      const started = new Promise(resolve => { markStarted = resolve; });
      state.started = markStarted;
      state.mode = 'hold';
      await page.locator('.feed-post [data-feed-report]').click();
      await page.locator('#feedReportReason').selectOption('hate');
      await page.locator('.feed-report-dialog [type=submit]').click();
      await started;
      await page.evaluate(() => document.querySelector('.feed-report-dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(state.writes.length, 3);
      const received = page.waitForResponse(response => response.url().endsWith(`/${reportPostId}/report`));
      await page.evaluate(() => {
        localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'different-fixture', user: { id: '55555555-5555-4555-8555-555555555555' } }));
        window.dispatchEvent(new Event('lumina:authchange'));
      });
      assert.equal(await page.locator('.feed-report-dialog').count(), 0);
      state.release();
      await (await received).finished();
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      assert.equal(await page.locator('.feed-report-dialog').count(), 0);
      assert.equal(state.writes.length, 3);
    } finally { state.release?.(); await page.close(); }
  }, true);
});

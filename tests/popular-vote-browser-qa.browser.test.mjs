import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PICK_UI_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.PICK_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-pick-20260928';
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
const slugs = ['yoon-serin', 'han-seoyul', 'park-doa', 'choi-seojin', 'oh-hyerin', 'min-chaeon', 'cha-dohyun'];

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

function fixtureResponse(path, state) {
  if (path === '/api/v1/popular-vote/main-pick') {
    if (state.failMain) return { status: 503, body: {} };
    return { status: 200, body: {
      campaign: { startsAt: state.campaignStart },
      leader: state.empty ? null : { artist: { slug: slugs[0] } },
      rankings: state.empty ? [] : slugs.map((slug, index) => ({ artist: { slug }, totalFreeLikes: 100 - index * 10 })),
    } };
  }
  if (path === '/api/v1/popular-vote/hall-of-fame/monthly-picks') {
    if (state.failArchive) return { status: 503, body: {} };
    return { status: 200, body: state.empty ? [] : [
      { month: 5, artist: { slug: slugs[1] }, totalFreeLikes: 23 },
      { month: 7, artist: { slug: slugs[2] }, totalFreeLikes: 42 },
    ] };
  }
  if (path === '/api/v1/popular-vote/hall-of-fame/year-champion') {
    return { status: 200, body: { champion: null } };
  }
  if (path === '/api/v1/me/settings') return { status: 200, body: {} };
  return { status: 200, body: {} };
}

async function setup(page, base, state, requests, { waitForReady = true } = {}) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    requests.push({ method: request.method(), path: url.pathname, year: url.searchParams.get('year') });
    if (url.pathname === '/api/v1/popular-vote/main-pick' && state.delayMain) {
      await new Promise((resolve) => { state.releaseMain = resolve; });
    }
    const result = fixtureResponse(url.pathname, state);
    return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('ls_splashed', '1');
    localStorage.setItem('lumina_locale', 'ko-KR');
  });
  await page.goto(`${base}/lumina-pick`, { waitUntil: 'domcontentloaded' });
  if (!waitForReady) return;
  await page.locator('body.is-ready').waitFor();
  await page.locator('#mainPickLeader .vote-leader-card, #mainPickLeader .vote-empty').first().waitFor();
}

async function assertNoClip(page, width, selectors) {
  const geometry = await page.evaluate((targets) => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    elements: targets.map((selector) => {
      const element = document.querySelector(selector);
      if (!element || element.closest('[hidden]') || getComputedStyle(element).display === 'none') return { selector, hidden: true };
      const bounds = element.getBoundingClientRect();
      return { selector, left: bounds.left, right: bounds.right };
    }),
  }), selectors);
  assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, `${width}px page overflow: ${JSON.stringify(geometry)}`);
  for (const element of geometry.elements) {
    if (element.hidden) continue;
    assert.ok(element.left >= -1 && element.right <= width + 1, `${width}px ${element.selector} clipped: ${JSON.stringify(element)}`);
  }
}

async function assertInitialHeadingClear(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
  const bounds = await page.evaluate(() => ({
    headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom,
    headingTop: document.querySelector('.page-hero h1').getBoundingClientRect().top,
  }));
  assert.ok(bounds.headingTop >= bounds.headerBottom, `header obscures heading: ${JSON.stringify(bounds)}`);
}

async function withBrowser(run) {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://pick.qa.test:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--host-resolver-rules=MAP pick.qa.test 127.0.0.1', '--no-proxy-server'],
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    });
    await run(browser, base);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('delayed prior-month pick cannot become the new KST month leader', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.install({ time: new Date('2026-12-31T14:59:00.000Z') });
    const state = { campaignStart: '2026-04-27T00:00:00.000Z', delayMain: true };
    const requests = [];
    let firstMain = true;
    let markMainStarted;
    const mainStarted = new Promise(resolve => { markMainStarted = resolve; });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base) return route.continue();
      if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
      requests.push({ method: request.method(), path: url.pathname, year: url.searchParams.get('year') });
      const result = fixtureResponse(url.pathname, state);
      if (url.pathname.endsWith('/main-pick') && firstMain) {
        firstMain = false;
        await new Promise(resolve => { state.releaseMain = resolve; markMainStarted(); });
      }
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
    });
    await page.addInitScript(() => { sessionStorage.setItem('ls_splashed', '1'); localStorage.setItem('lumina_locale', 'ko-KR'); });
    try {
      await page.goto(`${base}/lumina-pick`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#mainPickLeader .vote-empty')?.textContent === window.luminaI18n?.t('pick.status.loading'));
      await mainStarted;
      state.empty = true;
      await page.clock.setSystemTime(new Date('2026-12-31T15:01:00.000Z'));
      state.releaseMain();
      await page.waitForFunction(() => document.getElementById('heroLeaderName')?.textContent === '첫 응원 대기');
      assert.equal(await page.locator('#mainPickLeader .vote-leader-card').count(), 0);
      await page.locator('[data-tab="hall-of-fame"]').click();
      assert.equal(await page.locator('#voteArchiveYear').inputValue(), '2027');
      assert.ok(requests.some(request => request.path.endsWith('/monthly-picks') && request.year === '2027'));
      assert.equal(requests.filter(request => request.path.endsWith('/main-pick')).length, 2);
      assert.ok(requests.every(request => request.method === 'GET'));
      await assertNoClip(page, 390, ['.vote-archive-heading', '#voteArchiveYear', '.vote-monthly-grid']);
      await assertInitialHeadingClear(page);
      await page.screenshot({ path: join(artifacts, 'pick-delayed-year-rollover-390.png'), fullPage: true });
    } finally { state.releaseMain?.(); await page.close(); }
  });
});

for (const width of widths) {
  for (const locale of locales) {
    test(`Lumina Pick ${width}px ${locale} tabs, rankings and archive`, { timeout: 90_000 }, async () => {
      await withBrowser(async (browser, base) => {
        const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
        await page.clock.install({ time: new Date('2026-09-28T05:00:00.000Z') });
        const state = { campaignStart: '2026-04-27T00:00:00.000Z', empty: false };
        const requests = [];
        try {
          await setup(page, base, state, requests);
          await page.evaluate((value) => window.luminaI18n.setLocale(value), locale);
          assert.equal(await page.locator('html').getAttribute('lang'), locale);
          assert.equal(await page.locator('#mainPickLeader .vote-leader-card').count(), 1);
          assert.equal(await page.locator('.vote-ranking-row:visible').count(), 4);
          assert.equal(await page.locator('.vote-rankings-more').isVisible(), true);
          await assertNoClip(page, width, ['.page-hero-grid', '.vote-tabs', '.vote-tab-btn', '.vote-leader-card', '.vote-ranking-row', '.vote-rankings-more']);
          await assertInitialHeadingClear(page);
          await page.screenshot({ path: join(artifacts, `pick-${width}-${locale}-monthly.png`), fullPage: true });

          await page.locator('.vote-rankings-more').click();
          assert.equal(await page.locator('.vote-ranking-row:visible').count(), 6);
          await page.locator('[data-tab="debut-race"]').click();
          assert.equal(await page.locator('#tabDebutRace').isVisible(), true);
          assert.equal(await page.locator('.vote-debut-card').count() >= 7, true);
          await assertNoClip(page, width, ['.vote-tabs', '.vote-debut-grid', '.vote-debut-card', '.vote-debut-body']);
          await page.screenshot({ path: join(artifacts, `pick-${width}-${locale}-race.png`), fullPage: true });

          await page.locator('[data-tab="hall-of-fame"]').click();
          assert.equal(await page.locator('#tabHallOfFame').isVisible(), true);
          assert.equal(await page.locator('#voteArchiveYear').inputValue(), '2026');
          assert.equal(await page.locator('.vote-monthly-card').count() > 0, true);
          await assertNoClip(page, width, ['.vote-tabs', '.vote-archive-heading', '#voteArchiveYear', '.vote-monthly-grid', '.vote-monthly-card']);
          await page.screenshot({ path: join(artifacts, `pick-${width}-${locale}-archive.png`), fullPage: true });
          assert.equal(requests.some((entry) => entry.method !== 'GET'), false);
          assert.equal(requests.some((entry) => entry.path.includes('/monthly-picks') && entry.year === '2026'), true);
        } finally {
          await page.close();
        }
      });
    });
  }
}

test('KST new year exposes prior-year archive without showing it in current pick', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.install({ time: new Date('2026-12-31T15:12:00.000Z') });
    const state = { campaignStart: '2026-12-31T15:00:00.000Z', empty: true };
    const requests = [];
    try {
      await setup(page, base, state, requests);
      await page.locator('[data-tab="hall-of-fame"]').click();
      assert.equal(await page.locator('#voteArchiveYear').inputValue(), '2027');
      await page.locator('#voteArchiveYear').selectOption('2026');
      assert.equal(await page.locator('#voteArchiveYear').inputValue(), '2026');
      assert.equal(requests.some((entry) => entry.path.includes('/monthly-picks') && entry.year === '2026'), true);
      await assertNoClip(page, 390, ['.vote-archive-heading', '#voteArchiveYear', '.vote-monthly-grid']);
      await page.screenshot({ path: join(artifacts, 'pick-390-prior-year.png'), fullPage: true });
    } finally {
      await page.close();
    }
  });
});

test('loading failure, empty vote and keyboard tab access remain usable', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    const state = { campaignStart: '2026-04-27T00:00:00.000Z', failMain: true, failArchive: true };
    const requests = [];
    try {
      await setup(page, base, state, requests);
      assert.match(await page.locator('#mainPickLeader').innerText(), /불러오지 못했/);
      assert.equal(await page.locator('#heroLeaderName').innerText(), '집계 확인 불가');
      await page.locator('[data-tab="hall-of-fame"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#tabHallOfFame').isVisible(), true);
      assert.equal(await page.locator('#voteTabHallOfFame').getAttribute('aria-controls'), 'tabHallOfFame');
      assert.equal(await page.locator('#tabHallOfFame').getAttribute('aria-labelledby'), 'voteTabHallOfFame');
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#tabMainPick').isVisible(), true);
      assert.equal(await page.locator('#voteTabMainPick').getAttribute('tabindex'), '0');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tabDebutRace').isVisible(), true);
      await page.keyboard.press('End');
      assert.equal(await page.locator('#tabHallOfFame').isVisible(), true);
      assert.match(await page.locator('#monthlyPicksGrid').innerText(), /불러오지 못했/);
      await assertNoClip(page, 400, ['.vote-tabs', '.vote-archive-heading', '.vote-empty']);
      await page.screenshot({ path: join(artifacts, 'pick-400-error.png'), fullPage: true });

      state.failMain = false;
      state.failArchive = false;
      state.empty = true;
      await page.evaluate(() => window.refreshPopularVotePage());
      await page.locator('[data-tab="main-pick"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#tabMainPick').isVisible(), true);
      assert.match(await page.locator('#mainPickLeader').innerText(), /첫 응원/);
      assert.equal(await page.locator('#heroLeaderName').innerText(), '첫 응원 대기');
      await page.screenshot({ path: join(artifacts, 'pick-400-empty.png'), fullPage: true });
      assert.equal(requests.some((entry) => entry.method !== 'GET'), false);
    } finally {
      await page.close();
    }
  });
});

test('pending API response retains a visible localized loading state', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.clock.install({ time: new Date('2026-09-28T05:00:00.000Z') });
    const state = { campaignStart: '2026-04-27T00:00:00.000Z', delayMain: true };
    const requests = [];
    try {
      await setup(page, base, state, requests, { waitForReady: false });
      await page.waitForFunction(() => document.querySelector('#mainPickLeader .vote-empty')?.textContent === window.luminaI18n?.t('pick.status.loading'));
      assert.equal(await page.locator('#mainPickLeader .vote-empty').isVisible(), true);
      await assertNoClip(page, 390, ['.page-hero-grid', '.vote-tabs', '#mainPickLeader']);
      await page.screenshot({ path: join(artifacts, 'pick-390-loading.png'), fullPage: true });
      state.releaseMain();
      await page.locator('#mainPickLeader .vote-leader-card').waitFor();
    } finally {
      state.releaseMain?.();
      await page.close();
    }
  });
});

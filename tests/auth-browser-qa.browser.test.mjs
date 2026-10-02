import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = 'E:\\Codex\\LuminaStage\\qa-auth-20260928';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];
const widths = [1280, 390, 400];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

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

async function routeSynthetic(page, base, requests, responseFor) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
    requests.push({ method: request.method(), path: url.pathname });
    const response = responseFor(url.pathname, request.method());
    return route.fulfill({ status: response.status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(response.body || {}) });
  });
}

async function assertFits(page, selector, width) {
  const bounds = await page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.scrollWidth <= bounds.clientWidth + 1 && bounds.documentWidth <= width + 1, `${selector} clips at ${width}: ${JSON.stringify(bounds)}`);
}

async function assertNoOverlap(page, firstSelector, secondSelector) {
  const rectangles = await page.evaluate(([first, second]) => [first, second].map((selector) => {
    const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect();
    return { left, right, top, bottom };
  }), [firstSelector, secondSelector]);
  const [a, b] = rectangles;
  assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
    `${firstSelector} overlaps ${secondSelector}: ${JSON.stringify(rectangles)}`);
}

test('auth modal stays usable across locales, widths, tabs and synthetic failure states', { timeout: 180_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      const requests = [];
      await routeSynthetic(page, base, requests, (path) => path === '/api/v1/auth/password-resets'
        ? { status: 503, body: { message: 'synthetic failure' } }
        : path === '/api/v1/auth/login' ? { status: 401, body: { code: 'AUTH_INVALID_CREDENTIALS' } }
        : { body: { providers: [] } });
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('body.is-ready').waitFor();
      for (const locale of locales) {
        await page.evaluate((value) => window.luminaI18n.setLocale(value), locale);
        await page.locator('.brand').focus();
        await page.evaluate(() => openAuthModal('login'));
        await page.locator('#authModal.is-open').waitFor();
        await page.locator('[data-form="login"] input[name="email"]').waitFor();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).overflow), 'hidden');
        assert.equal(await page.locator('.auth-modal').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('#authModal').evaluate((el) => el.contains(document.activeElement)), true);
        await assertFits(page, '.auth-modal', width);
        await assertNoOverlap(page, '.auth-modal-close', '.auth-modal-tabs');
        await page.locator('[data-form="login"] input[name="email"]').fill('qa@example.invalid');
        await page.locator('[data-form="login"] input[name="password"]').fill('synthetic-only');
        await page.locator('[data-form="login"] .auth-modal-submit').click();
        await page.locator('[data-form="login"] [data-error]:visible').waitFor();
        if (locale !== 'ko-KR') assert.doesNotMatch(await page.locator('[data-form="login"] [data-error]').innerText(), /[가-힣]/);
        await page.screenshot({ path: join(artifacts, `modal-login-error-${width}-${locale}.png`) });
        await page.locator('.auth-modal-tab[data-tab="register"]').click();
        assert.equal(await page.locator('[data-form="register"]').isVisible(), true);
        const registerLabel = await page.locator('.auth-modal').evaluate((el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent);
        assert.equal(registerLabel, await page.locator('[data-form="register"] h2').innerText());
        const scroll = await page.locator('.auth-modal').evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }));
        if (scroll.content > scroll.height) {
          await page.locator('.auth-modal').evaluate((el) => { el.scrollTop = el.scrollHeight; });
          assert.equal(await page.locator('[data-form="register"] .auth-modal-submit').isVisible(), true);
        }
        await page.locator('[data-form="register"] .auth-modal-submit').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#authModal').evaluate((el) => el.contains(document.activeElement)), true, `focus escaped register dialog ${width} ${locale}`);
        await page.locator('[data-foot="register"] .auth-modal-switch').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.auth-modal-close').evaluate((el) => el === document.activeElement), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('[data-foot="register"] .auth-modal-switch').evaluate((el) => el === document.activeElement), true);
        await page.locator('.auth-modal-tab[data-tab="login"]').click();
        await page.locator('[data-switch="forgot"]').first().click();
        assert.equal(await page.locator('[data-form="forgot"]').isVisible(), true);
        assert.equal(await page.locator('[data-form="forgot"] input[name="email"]').evaluate((el) => el === document.activeElement), true);
        const dialogLabel = await page.locator('.auth-modal').evaluate((el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent);
        assert.equal(dialogLabel, await page.locator('[data-form="forgot"] h2').innerText());
        await page.locator('[data-form="forgot"] input[name="email"]').fill('qa@example.invalid');
        await page.locator('[data-form="forgot"] .auth-modal-submit').click();
        await page.locator('[data-form="forgot"] [data-error]:visible').waitFor();
        if (locale !== 'ko-KR') assert.doesNotMatch(await page.locator('[data-form="forgot"] [data-error]').innerText(), /[가-힣]/);
        assert.equal(await page.locator('[data-form="forgot"] [data-info]').isVisible(), false);
        assert.equal(await page.locator('[data-form="forgot"] .auth-modal-submit').isEnabled(), true);
        await assertFits(page, '.auth-modal', width);
        await page.screenshot({ path: join(artifacts, `modal-forgot-error-${width}-${locale}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#authModal').isVisible(), false);
        assert.notEqual(await page.locator('body').evaluate((el) => getComputedStyle(el).overflow), 'hidden');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('brand')), true, `focus not restored ${width} ${locale}`);
      }
      assert.equal(requests.filter((r) => r.path === '/api/v1/auth/password-resets' && r.method === 'POST').length, locales.length);
      assert.equal(requests.filter((r) => r.path === '/api/v1/auth/login' && r.method === 'POST').length, locales.length);
      if (width < 500) {
        await page.setViewportSize({ width, height: 568 });
        await page.evaluate(() => openAuthModal('register'));
        await page.locator('#authModal.is-open').waitFor();
        const scroll = await page.locator('.auth-modal').evaluate((el) => ({ content: el.scrollHeight, height: el.clientHeight }));
        assert.ok(scroll.content > scroll.height, `register panel should scroll at ${width}x568: ${JSON.stringify(scroll)}`);
        await page.locator('[data-form="register"] .auth-modal-submit').scrollIntoViewIfNeeded();
        const visible = await page.locator('[data-form="register"] .auth-modal-submit').evaluate((el) => {
          const button = el.getBoundingClientRect();
          const panel = el.closest('.auth-modal').getBoundingClientRect();
          return button.top >= panel.top - 1 && button.bottom <= panel.bottom + 1;
        });
        assert.equal(visible, true);
        await page.screenshot({ path: join(artifacts, `modal-register-scroll-${width}.png`) });
        await page.keyboard.press('Escape');
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reset and verify links show synthetic API error states without leaking tokens', { timeout: 360_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const width of widths) for (const locale of locales) {
      for (const [path, state, status, body] of [
        ['reset-password', 'expired', 410, { details: { state: 'expired' } }],
        ['reset-password', 'used', 409, { details: { state: 'already_used' } }],
        ['reset-password', 'invalid', 404, { details: { state: 'invalid' } }],
        ['reset-password', 'error', 503, { message: 'synthetic failure' }],
        ['reset-password', 'inactive', 200, { status: 'user_not_active' }],
        ['verify-email', 'expired', 410, { details: { state: 'expired' } }],
        ['verify-email', 'used', 409, { details: { state: 'already_used' } }],
        ['verify-email', 'invalid', 404, { details: { state: 'invalid' } }],
        ['verify-email', 'error', 503, { message: 'synthetic failure' }],
      ]) {
        const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
        const requests = [];
        await routeSynthetic(page, base, requests, (urlPath) => urlPath.includes('/auth/')
          ? { status, body } : { body: { providers: [] } });
        await page.addInitScript((value) => {
          sessionStorage.setItem('ls_splashed', '1');
          localStorage.setItem('lumina_locale', value);
        }, locale);
        await page.goto(`${base}/${path}/?token=synthetic-token`, { waitUntil: 'domcontentloaded' });
        await page.locator(`#${path === 'reset-password' ? 'resetPwCard' : 'verifyEmailCard'}[data-state="${state}"]`).waitFor();
        assert.doesNotMatch(page.url(), /synthetic-token/);
        assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-token/);
        assert.equal(await page.locator('html').getAttribute('lang'), locale);
        await assertFits(page, '.auth-confirm-card', width);
        if (locale !== 'ko-KR') {
          assert.doesNotMatch(await page.locator('.auth-confirm-card').innerText(), /[가-힣]/, `${path} ${state} left Korean copy in ${locale}`);
        }
        await page.screenshot({ path: join(artifacts, `${path}-${state}-${width}-${locale}.png`), fullPage: true });
        assert.equal(requests.filter((r) => r.method === 'POST').length, 1);
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reset form validation and rejected confirm remain usable without a real account write', { timeout: 90_000 }, async () => {
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      const requests = [];
      await routeSynthetic(page, base, requests, (path) => path.endsWith('/inspect')
        ? { body: { status: 'valid', canReset: true, email: { masked: 'q***@example.invalid' } } }
        : path.endsWith('/confirm') ? { status: 422, body: { code: 'PASSWORD_TOO_SHORT' } }
          : { body: { providers: [] } });
      await page.addInitScript((value) => {
        sessionStorage.setItem('ls_splashed', '1');
        localStorage.setItem('lumina_locale', value);
      }, locale);
      await page.goto(`${base}/reset-password/?token=synthetic-token`, { waitUntil: 'domcontentloaded' });
      await page.locator('#resetPwCard[data-state="form"]').waitFor();
      assert.equal(await page.locator('#resetPwEmailHint').isVisible(), true);
      if (locale !== 'ko-KR') assert.doesNotMatch(await page.locator('.auth-confirm-card').innerText(), /[가-힣]/);
      await page.locator('#resetPwSubmit').click();
      assert.equal(await page.locator('#resetPwError').isVisible(), true);
      await page.locator('#resetPwNew').fill('synthetic-pass-1');
      await page.locator('#resetPwConfirm').fill('synthetic-pass-2');
      await page.locator('#resetPwSubmit').click();
      assert.equal(await page.locator('#resetPwError').isVisible(), true);
      await page.locator('#resetPwConfirm').fill('synthetic-pass-1');
      const rejectedConfirm = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/password-resets/confirm'));
      await page.locator('#resetPwSubmit').click();
      await rejectedConfirm;
      await page.waitForFunction(() => document.querySelector('#resetPwError')?.textContent?.length > 0 && !document.querySelector('#resetPwSubmit')?.disabled);
      assert.equal(await page.locator('#resetPwCard').getAttribute('data-state'), 'form');
      assert.equal(await page.locator('#resetPwSubmit').isEnabled(), true);
      assert.equal(requests.filter((r) => r.path.endsWith('/confirm')).length, 1);
      if (locale !== 'ko-KR') assert.doesNotMatch(await page.locator('.auth-confirm-card').innerText(), /[가-힣]/);
      await assertFits(page, '.auth-confirm-card', width);
      await page.screenshot({ path: join(artifacts, `reset-password-input-error-${width}-${locale}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

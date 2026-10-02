import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const origin = 'https://studio-access.fixture.invalid';
const artifacts = process.env.STUDIO_ACCESS_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-studio-access-20261001';
const auth = { accessToken: 'private-fixture-token', user: { id: 'fixture-owner', email: 'fixture@example.invalid' } };
const workId = '11111111-1111-4111-8111-111111111111';
let browser;
before(async () => {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.STORY_UI_BROWSER });
});
after(async () => { await browser?.close(); });

async function fixture({ width = 390, approved = false, cached = false, apiOrigin = origin, hook } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ apiOrigin, auth, cached }) => {
    window.LUMINA_API_BASE = apiOrigin;
    localStorage.setItem('lumina_auth', JSON.stringify(auth));
    if (cached) sessionStorage.setItem('lumina_creator_studio_handoff', JSON.stringify({ savedAt: Date.now() + 100_000,
      data: { access: { enabled: true }, artists: [{ artist: { displayName: 'DO NOT RENDER OLD ARTIST' } }] } }));
  }, { apiOrigin, auth, cached });
  const calls = [], errors = [];
  let created = false;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin && url.origin !== apiOrigin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const call = { path: url.pathname, method: req.method(), body: req.postData(), headers: req.headers() };
      calls.push(call);
      const custom = await hook?.(call);
      if (custom) return route.fulfill({ status: custom.status || 200, json: custom.data });
      if (call.path === '/api/v1/me/creator-studio') return route.fulfill({ json: {
        access: { enabled: approved }, viewer: { userId: auth.user.id }, artists: [], summary: {}, policy: {}
      } });
      if (call.path === '/api/v1/me/creator-studio/stories') {
        if (call.method === 'POST') {
          created = true;
          return route.fulfill({ json: { workId, status: 'draft' } });
        }
        return route.fulfill({ json: { items: created ? [{ workId, slug: 'draft-' + workId,
          title: { value: '비공개 첫 작품' }, publication: { status: 'draft', published: false },
          permissions: { createManuscript: true } }] : [], nextCursor: null } });
      }
      return route.fulfill({ status: 404, json: { error: 'isolated fixture only' } });
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative.endsWith('/') ? relative + 'index.html' : relative);
    if (!filename.startsWith(root + path.sep)) return route.abort();
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    try { return route.fulfill({ body: await readFile(filename), contentType: types[path.extname(filename)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/creator-studio/#writer-manuscript');
  return { page, calls, errors, close: () => context.close() };
}

async function geometry(page, selectors, width) {
  const result = await page.evaluate(selectors => ({ document: document.documentElement.scrollWidth,
    boxes: selectors.map(selector => ({ selector, box: document.querySelector(selector).getBoundingClientRect().toJSON() })) }), selectors);
  assert.ok(result.document <= width + 1, JSON.stringify(result));
  for (const { selector, box } of result.boxes) assert.ok(box.left >= -1 && box.right <= width + 1, selector + ' is clipped');
}

test('actual studio entry denies cached approval and exposes a usable retry on desktop and mobile', { timeout: 60_000 }, async () => {
  for (const width of [1280, 390]) {
    const f = await fixture({ width, cached: true });
    try {
      await f.page.locator('#studioGateActions').waitFor({ state: 'visible' });
      assert.equal(await f.page.locator('#studioShell').isVisible(), false);
      assert.equal(await f.page.getByText('DO NOT RENDER OLD ARTIST').count(), 0);
      assert.equal(f.calls.filter(call => call.path === '/api/v1/me/creator-studio').length, 1);
      await geometry(f.page, ['#studioAccessGate', '[data-studio-retry]'], width);
      await f.page.screenshot({ path: path.join(artifacts, `denied-${width}.png`) });
      await f.page.locator('[data-studio-retry]').click();
      await f.page.waitForFunction(() => !document.getElementById('studioGateActions').hidden);
      assert.equal(f.calls.filter(call => call.path === '/api/v1/me/creator-studio').length, 2);
      assert.equal(await f.page.locator('#studioShell').isVisible(), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('approved first writer creates/selects one private work; a switched account must recheck permission', { timeout: 60_000 }, async () => {
  for (const width of [1280, 390]) {
    const f = await fixture({ width, approved: true });
    try {
      await f.page.locator('#studioShell').waitFor({ state: 'visible' });
      await f.page.waitForFunction(() => document.getElementById('writerManuscriptState').textContent &&
        !document.getElementById('writerDraftCreate').disabled);
      await f.page.locator('#writerDraftCreate').click();
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 0, 'empty title must not send');
      await f.page.locator('#writerDraftTitle').fill('비공개 첫 작품');
      await f.page.locator('#writerDraftCreate').click();
      await f.page.waitForFunction(workId => document.getElementById('writerManuscriptWork').value === workId, workId);
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(await f.page.locator('#writerDraftMetadata').isVisible(), true);
      await f.page.locator('#writerDraftTitle').scrollIntoViewIfNeeded();
      await geometry(f.page, ['#writerDraftTitle', '#writerDraftCreate', '#writerManuscriptWork'], width);
      await f.page.screenshot({ path: path.join(artifacts, `first-work-${width}.png`) });
      await f.page.locator('#writerManuscriptBody').fill('private unsent draft');
      await f.page.locator('#writerDraftTitle').fill('private pending title');
      await f.page.locator('#writerMetadataAuthor').fill('private author');
      await f.page.evaluate(() => {
        localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'other', user: { id: 'other-owner' } }));
        window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' }));
      });
      assert.equal(await f.page.locator('#studioShell').isVisible(), false);
      assert.equal(await f.page.locator('#writerManuscriptBody').inputValue(), '');
      assert.equal(await f.page.locator('#writerDraftTitle').inputValue(), '');
      assert.equal(await f.page.locator('#writerMetadataAuthor').inputValue(), '');
      assert.equal(await f.page.locator('#writerManuscriptWork').isEnabled(), false);
      assert.equal(await f.page.locator('[data-studio-retry]').isVisible(), true);
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 1, 'no account-switch resubmission');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('real common auth and Studio share one rotation without clearing the unsent writer draft', { timeout: 30_000 }, async () => {
  const f = await fixture({ approved: true, apiOrigin: 'https://api.lumina-stage.com', hook: async call => {
    if (call.path === '/api/v1/auth/refresh') {
      await new Promise(resolve => setTimeout(resolve, 40));
      return { data: { accessToken: 'rotated-fixture', refreshToken: 'rotated-refresh', user: auth.user } };
    }
    if (call.path.endsWith('/test-rotation')) return { status: call.headers.authorization === 'Bearer rotated-fixture' ? 200 : 401, data: {} };
  } });
  try {
    await f.page.locator('#studioShell').waitFor({ state: 'visible' });
    await f.page.evaluate(() => {
      const login = JSON.parse(localStorage.getItem('lumina_auth'));
      localStorage.setItem('lumina_auth', JSON.stringify({ ...login, refreshToken: 'fixture-refresh' }));
    });
    // This deliberate new session must be checked before testing normal rotation.
    await f.page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })));
    await f.page.locator('[data-studio-retry]').click();
    await f.page.locator('#studioShell').waitFor({ state: 'visible' });
    await f.page.locator('#writerManuscriptBody').fill('private draft survives normal refresh');
    const result = await f.page.evaluate(async () => {
      const [auth, response] = await Promise.all([
        window.refreshAuthOnce(), window.LuminaCreatorStudioApi.fetch('/api/v1/me/creator-studio/test-rotation')
      ]);
      return { token: auth?.accessToken, status: response.status };
    });
    assert.deepEqual(result, { token: 'rotated-fixture', status: 200 });
    assert.equal(f.calls.filter(call => call.path === '/api/v1/auth/refresh').length, 1);
    assert.equal(await f.page.locator('#studioShell').isVisible(), true);
    assert.equal(await f.page.locator('#writerManuscriptBody').inputValue(), 'private draft survives normal refresh');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('switching owners during a pending paste restores the next catalog and isolates both submissions', { timeout: 30_000 }, async () => {
  let finishOld, finishNext;
  const oldReply = new Promise(resolve => { finishOld = resolve; });
  const nextReply = new Promise(resolve => { finishNext = resolve; });
  const nextWork = '22222222-2222-4222-8222-222222222222';
  const f = await fixture({ approved: true, hook: call => {
    const next = call.headers.authorization === 'Bearer other';
    if (call.path === '/api/v1/me/creator-studio' && next) return {
      data: { access: { enabled: true }, viewer: { userId: 'other-owner' }, artists: [], summary: {} }
    };
    if (call.path === '/api/v1/me/creator-studio/stories' && call.method === 'GET') return { data: {
      items: [{ workId: next ? nextWork : workId, title: { value: next ? '새 계정 작품' : '이전 계정 작품' },
        permissions: { createManuscript: true } }], nextCursor: null
    } };
    if (call.path.endsWith('/manuscripts/paste')) return next ? nextReply : oldReply;
  } });
  try {
    await f.page.locator('#studioShell').waitFor({ state: 'visible' });
    await f.page.waitForFunction(() => !document.getElementById('writerManuscriptWork').disabled);
    await f.page.locator('#writerManuscriptWork').selectOption(workId);
    await f.page.locator('#writerManuscriptBody').fill('old private pending source');
    await f.page.locator('#writerManuscriptParts input[maxlength="240"]').fill('이전 파트');
    await f.page.locator('#writerManuscriptReview').click();
    await f.page.locator('#writerManuscriptConfirm').check();
    await f.page.locator('#writerManuscriptSubmit').click();
    assert.equal(await f.page.locator('#writerManuscriptBody').isEnabled(), false);
    await f.page.evaluate(() => {
      localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'other', user: { id: 'other-owner' } }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' }));
    });
    await f.page.locator('[data-studio-retry]').click();
    await f.page.waitForFunction(() => !document.getElementById('studioShell').hidden &&
      !document.getElementById('writerManuscriptWork').disabled);
    await f.page.locator('#writerManuscriptWork').selectOption(nextWork);
    await f.page.locator('#writerManuscriptBody').fill('new owner pending source');
    await f.page.locator('#writerManuscriptParts input[maxlength="240"]').fill('새 파트');
    await f.page.locator('#writerManuscriptReview').click();
    await f.page.locator('#writerManuscriptConfirm').check();
    await f.page.locator('#writerManuscriptSubmit').click();
    const oldResponse = f.page.waitForResponse(response => response.url().includes(`/stories/${workId}/manuscripts/paste`));
    finishOld({ data: { status: 'received', privateReceipt: 'do not apply' } });
    await oldResponse;
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.page.locator('#writerManuscriptBody').inputValue(), 'new owner pending source');
    assert.equal(await f.page.locator('#writerManuscriptWork').inputValue(), nextWork);
    assert.equal(await f.page.locator('#writerManuscriptSubmit').isEnabled(), false);
    assert.equal(await f.page.evaluate(() => window.LuminaCreatorManuscript.receipt()), null);
    finishNext({ status: 503, data: {} });
    await f.page.waitForFunction(() => !document.getElementById('writerManuscriptBody').disabled);
    assert.equal(await f.page.locator('#writerManuscriptBody').inputValue(), 'new owner pending source');
    assert.equal(f.calls.filter(call => call.path.endsWith('/manuscripts/paste')).length, 2);
    assert.equal(f.calls.filter(call => call.path === '/api/v1/me/creator-studio/stories' && call.headers.authorization === 'Bearer other').length, 1);
    assert.deepEqual(f.errors, []);
  } finally {
    finishOld({ status: 503, data: {} }); finishNext({ status: 503, data: {} });
    await f.close();
  }
});

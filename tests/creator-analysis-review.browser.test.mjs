import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ids, makeJob, makeEvidence, citation, quoteText, deferred } from './creator-analysis-review.test-support.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STORY_UI_PLAYWRIGHT || 'playwright');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const origin = 'https://creator-analysis.fixture.invalid';
const artifacts = process.env.STORY_UI_ARTIFACTS;
const manuscriptText = 'Local private QA manuscript fixture.\nNot an authored or public work.';
const longObservation = 'Local analysis fixture, not an actual manuscript interpretation. '.repeat(16);
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.STORY_UI_BROWSER, headless: true }); });
after(async () => { await browser?.close(); });

async function fixture({ locale = 'en-US', width = 390, rows = [makeEvidence(0, { observation: longObservation })], hook } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 400 ? 900 : 844 }, serviceWorkers: 'block' });
  await context.addInitScript(({ origin, locale }) => {
    window.LUMINA_API_BASE = origin;
    localStorage.setItem('lumina_locale', locale);
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'local-fixture-token', user: { id: 'fixture-owner', email: 'private-fixture@example.invalid' } }));
  }, { origin, locale });
  const calls = [], unexpectedWrites = [], errors = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const call = { path: url.pathname, cursor: url.searchParams.get('cursor'), method: req.method(), headers: req.headers(), body: req.postData() };
      calls.push(call);
      const custom = await hook?.(call);
      if (custom?.abort) return route.abort();
      if (custom) return route.fulfill({ status: custom.status || 200, json: custom.body });
      const job = makeJob({ evidenceCount: rows.length });
      if (call.path === '/api/v1/me/creator-studio') return route.fulfill({ json: { access: { enabled: true }, artists: [], summary: {}, policy: {} } });
      if (call.path.endsWith('/creator-studio/stories')) return route.fulfill({ json: { items: [{ workId: ids.work, title: { value: 'Local private QA work' }, permissions: { createManuscript: true } }], nextCursor: null } });
      if (call.path.endsWith('/manuscripts/paste') && call.method === 'POST') {
        assert.ok(call.body.includes(manuscriptText));
        return route.fulfill({ json: { manuscript: { id: ids.manuscript, workId: ids.work, locale: 'ko', version: 3, contentHash: 'a'.repeat(64) },
          received: { sourceKind: 'utf8_paste', byteLength: Buffer.byteLength(manuscriptText), parts: 1 }, analysisStarted: false, idempotentReplay: false } });
      }
      if (call.path.endsWith(`/manuscripts/${ids.manuscript}/analyses`) && call.method === 'POST') return route.fulfill({ json: job });
      if (call.path.endsWith(`/analyses/${ids.job}`)) {
        const start = call.cursor ? rows.findIndex(row => row.id === call.cursor) + 1 : 0;
        const evidence = rows.slice(start, start + 100), hasMore = rows.length > start + evidence.length;
        const endCursor = evidence.at(-1)?.id || call.cursor;
        return route.fulfill({ json: { job, evidence, bounded: true, hasMore, endCursor, nextCursor: hasMore ? endCursor : null,
          review: { status: 'not_approved', fullyReviewed: false, publicationApproved: false, memoryApproved: false } } });
      }
      const source = call.path.match(/\/evidence\/([^/]+)\/source$/);
      if (source) return route.fulfill({ json: { evidenceId: source[1], manuscriptVersionId: ids.manuscript, sourceLocale: 'ko', citations: [{ ...citation, quote: quoteText }], reviewRequired: true } });
      if (call.method !== 'GET') unexpectedWrites.push(call.path);
      return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Local fixture only' } } });
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative.endsWith('/') ? relative + 'index.html' : relative);
    if (!filename.startsWith(root + path.sep)) return route.abort();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
    try { return await route.fulfill({ body: await readFile(filename), contentType: types[path.extname(filename)] || 'application/octet-stream' }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/creator-studio/#writer-manuscript');
  try {
    await page.waitForFunction(() => window.LuminaCreatorAnalysis && document.querySelector('#writerManuscriptWork option[value]') && !document.getElementById('writerManuscriptWork').disabled);
  } catch (error) {
    const state = await page.evaluate(() => ({ gate: document.getElementById('studioGateBody')?.textContent,
      catalog: document.getElementById('writerManuscriptWork')?.outerHTML, analysisLoaded: Boolean(window.LuminaCreatorAnalysis),
      writerState: document.getElementById('writerManuscriptState')?.textContent }));
    await context.close();
    throw new Error(JSON.stringify({ failure: error.message, state, errors, paths: calls.map(call => call.method + ' ' + call.path) }));
  }
  await page.locator('#writerManuscriptWork').selectOption(ids.work);
  await page.locator('#writerManuscriptBody').fill(manuscriptText);
  await page.locator('#writerManuscriptParts input[maxlength="240"]').fill('Local fixture part');
  await page.locator('#writerManuscriptReview').click();
  await page.locator('#writerManuscriptConfirm').check();
  await page.locator('#writerManuscriptSubmit').click();
  await page.locator('#writerAnalysisStart').waitFor({ state: 'visible' });
  return { page, calls, errors, unexpectedWrites, close: () => context.close(),
    start: async () => { await page.locator('#writerAnalysisStart').click(); await page.locator('.writer-analysis-item').first().waitFor(); } };
}

test('analysis browser functional: actual paste receipt then explicit one analysis request and source quotation', async () => {
  const f = await fixture();
  try {
    assert.equal(f.calls.filter(call => call.path.endsWith('/analyses')).length, 0);
    await f.start();
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 1);
    await f.page.locator('.writer-analysis-item button').click();
    await f.page.locator('blockquote').waitFor();
    assert.equal(await f.page.locator('blockquote').textContent(), quoteText);
    assert.equal(await f.page.locator('#writerAnalysis script').count(), 0);
    assert.deepEqual(f.unexpectedWrites, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('analysis browser functional: full cursor traversal and reread do not enqueue or approve again', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => makeEvidence(index));
  const f = await fixture({ width: 400, rows });
  try {
    await f.start();
    await f.page.locator('#writerAnalysisNext').click();
    await f.page.locator('.writer-analysis-item h3').first().filter({ hasText: 'Local fixture 101' }).waitFor();
    await f.page.locator('#writerAnalysisNext').click();
    await f.page.locator('.writer-analysis-item h3').last().filter({ hasText: 'Local fixture 205' }).waitFor();
    assert.equal(await f.page.locator('.writer-analysis-item').count(), 5);
    assert.equal(await f.page.locator('#writerAnalysisNext').isDisabled(), true);
    await f.page.locator('#writerAnalysisPrevious').click();
    await f.page.locator('.writer-analysis-item h3').first().filter({ hasText: 'Local fixture 101' }).waitFor();
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 1);
    assert.deepEqual(f.unexpectedWrites, []);
  } finally { await f.close(); }
});

test('analysis browser functional: unknown response keeps original key; nested reserved response cannot guess job', async () => {
  let dropped = false;
  const f = await fixture({ hook: call => {
    if (call.method === 'POST' && call.path.endsWith('/analyses') && !dropped) { dropped = true; return { abort: true }; }
  } });
  try {
    await f.page.locator('#writerAnalysisStart').click();
    await f.page.waitForFunction(() => !document.getElementById('writerAnalysisCheck').hidden && !document.getElementById('writerAnalysisCheck').disabled);
    await f.page.locator('#writerAnalysisCheck').click();
    await f.page.locator('.writer-analysis-item').waitFor();
    const posts = f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses'));
    assert.equal(posts.length, 2);
    assert.equal(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  } finally { await f.close(); }
  const reserved = await fixture({ hook: call => call.method === 'POST' && call.path.endsWith('/analyses') ?
    { status: 409, body: { success: false, error: { code: 'ANALYSIS_VERSION_ALREADY_RESERVED', message: 'Private diagnostic' } } } : null });
  try {
    await reserved.page.locator('#writerAnalysisStart').click();
    await reserved.page.waitForFunction(() => document.getElementById('writerAnalysisState').textContent.includes('already has an analysis request'));
    assert.equal(await reserved.page.locator('#writerAnalysisCheck').isVisible(), false);
    assert.equal(reserved.calls.filter(call => /\/analyses\//.test(call.path)).length, 0);
    assert.doesNotMatch(await reserved.page.locator('#writerAnalysis').innerText(), /Private diagnostic|ANALYSIS_VERSION/);
  } finally { await reserved.close(); }
});

test('analysis browser functional: late private source cannot repaint after account switch', async () => {
  const gate = deferred();
  const f = await fixture({ hook: async call => { if (call.path.endsWith('/source')) { await gate.promise; return null; } } });
  try {
    await f.start(); await f.page.locator('.writer-analysis-item button').click();
    await f.page.evaluate(() => {
      localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'new-fixture-token', user: { id: 'other-owner' } }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' }));
    });
    gate.resolve();
    await f.page.locator('#writerAnalysis').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('#writerAnalysisEvidence').textContent(), '');
  } finally { gate.resolve(); await f.close(); }
});

for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) for (const width of [390, 400, 1280]) {
  test(`analysis browser visual: ${locale} ${width} private evidence and source`, async () => {
    assert.match(artifacts || '', /^E:[/\\]/i, 'explicit E artifact directory required');
    const f = await fixture({ locale, width });
    try {
      await f.start();
      assert.equal(await f.page.locator('.writer-analysis-item > p').last().textContent(), longObservation);
      await f.page.locator('.writer-analysis-item button').click();
      await f.page.locator('blockquote').waitFor();
      assert.equal(await f.page.locator('blockquote').textContent(), quoteText);
      const controls = f.page.locator('#writerAnalysis button:visible');
      for (let index = 0; index < await controls.count(); index++) {
        const control = controls.nth(index);
        await control.scrollIntoViewIfNeeded();
        assert.ok(await control.evaluate(button => { const r = button.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.width >= 40 && r.height >= 40 && (hit === button || button.contains(hit)); }));
      }
      await f.page.locator('#writerAnalysis').evaluate(panel => panel.scrollIntoView({ block: 'start' }));
      const metrics = await f.page.locator('#writerAnalysis').evaluate(panel => {
        const rect = panel.getBoundingClientRect();
        const text = panel.querySelector('.writer-analysis-item > p:last-of-type');
        const style = getComputedStyle(text);
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, panelWidth: rect.width,
          fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
          quoteLength: panel.querySelector('blockquote').textContent.length,
          rawKeysVisible: /writerAnalysis\.|ANALYSIS_VERSION|33333333/.test(panel.innerText),
          observationLength: text.textContent.length };
      });
      assert.ok(metrics.documentWidth <= width + 1);
      assert.equal(metrics.fontSize, '16px'); assert.equal(metrics.fontWeight, '400');
      assert.equal(metrics.rawKeysVisible, false); assert.equal(metrics.observationLength, longObservation.length);
      assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
      await mkdir(artifacts, { recursive: true });
      const name = `${locale}-${width}-analysis`;
      await f.page.screenshot({ path: path.join(artifacts, name + '.png') });
      await writeFile(path.join(artifacts, name + '.json'), JSON.stringify({
        caption: 'Local private API/manuscript fixtures only. Existing brand images are not story art. Not real provider/PG, writer approval, publication or cross-device discovery proof.',
        locale, ...metrics }, null, 2));
    } finally { await f.close(); }
  });
}

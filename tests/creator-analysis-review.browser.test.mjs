import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ids, sourceHash, makeJob, makeRecoverableJob, makeGenerationResponse, makeVisualGenerationResponse, makeEvidence, citation, quoteText, deferred } from './creator-analysis-review.test-support.mjs';

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

async function fixture({ locale = 'en-US', width = 390, rows = [makeEvidence(0, { observation: longObservation })], hook,
  submit = true, expectAnalysis = true, draft = true, job = makeJob({ evidenceCount: rows.length }), generationProfile } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width > 400 ? 900 : 844 }, serviceWorkers: 'block' });
  await context.addInitScript(({ origin, locale }) => {
    window.LUMINA_API_BASE = origin;
    localStorage.setItem('lumina_locale', locale);
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'local-fixture-token', user: { id: 'fixture-owner', email: 'private-fixture@example.invalid' } }));
  }, { origin, locale });
  const calls = [], unexpectedWrites = [], errors = [];
  let currentJob = job;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const call = { path: url.pathname, cursor: url.searchParams.get('cursor'), view: url.searchParams.get('view'), method: req.method(), headers: req.headers(), body: req.postData() };
      calls.push(call);
      const custom = await hook?.(call);
      if (custom?.abort) return route.abort();
      if (custom) return route.fulfill({ status: custom.status || 200, json: custom.body });
      if (call.path === '/api/v1/me/creator-studio') return route.fulfill({ json: { access: { enabled: true }, artists: [], summary: {}, policy: {} } });
      if (call.path.endsWith('/creator-studio/stories')) return route.fulfill({ json: { items: [{ workId: ids.work, title: { value: 'Local private QA work' }, permissions: { createManuscript: true } }], nextCursor: null } });
      if (call.path.endsWith('/manuscripts/paste') && call.method === 'POST') {
        assert.ok(call.body.includes(manuscriptText));
        return route.fulfill({ json: { manuscript: { id: ids.manuscript, workId: ids.work, locale: 'ko', version: 3, contentHash: 'a'.repeat(64) },
          received: { sourceKind: 'utf8_paste', byteLength: Buffer.byteLength(manuscriptText), parts: 1 }, analysisStarted: false, idempotentReplay: false } });
      }
      if (call.path.endsWith(`/stories/${ids.work}/manuscripts`) && call.method === 'GET') return route.fulfill({ json: {
        workId: ids.work, items: [{ id: ids.manuscript, workId: ids.work, locale: 'ko', version: 3, contentHash: sourceHash }] } });
      if (call.path.endsWith(`/manuscripts/${ids.manuscript}/analyses`) && call.method === 'GET') return route.fulfill({ json: {
        manuscriptVersionId: ids.manuscript, items: [currentJob] } });
      if (call.path.endsWith(`/manuscripts/${ids.manuscript}/analyses`) && call.method === 'POST') return route.fulfill({ json: currentJob });
      if (call.path.endsWith(`/analyses/${ids.job}/recover-profile`) && call.method === 'POST') {
        assert.deepEqual(JSON.parse(call.body), { expectedSourceContentHash: currentJob.sourceContentHash });
        currentJob = { ...currentJob, status: 'completed', phase: 'completed', semanticCompleted: true, errorCode: null,
          progress: { ...currentJob.progress, coverageComplete: true }, profileRecovery: { available: false, mode: 'local_settings_only' } };
        return route.fulfill({ json: currentJob });
      }
      if (generationProfile && call.path.endsWith(`/stories/${ids.work}/generation-profile`)) {
        if (call.method === 'GET') return route.fulfill({ json: generationProfile });
        if (call.method === 'PATCH') {
          generationProfile = { ...generationProfile, profile: { ...generationProfile.profile, draftSettings: JSON.parse(call.body).settings } };
          return route.fulfill({ json: generationProfile });
        }
      }
      if (generationProfile && call.path.endsWith(`/stories/${ids.work}/generation-profile/approve`) && call.method === 'POST') {
        assert.deepEqual(JSON.parse(call.body), { expectedDraftFingerprint: generationProfile.profile.draftFingerprint });
        generationProfile = { ...generationProfile, profile: { ...generationProfile.profile,
          status: 'approved', approvedSettings: generationProfile.profile.draftSettings } };
        return route.fulfill({ json: generationProfile });
      }
      if (call.path.endsWith(`/analyses/${ids.job}`)) {
        const visibleRows = rows.filter(row => call.view === 'semantic' ? row.provenance === 'semantic_candidate' :
          call.view === 'structural' ? row.provenance !== 'semantic_candidate' : true);
        const start = call.cursor ? visibleRows.findIndex(row => row.id === call.cursor) + 1 : 0;
        const evidence = visibleRows.slice(start, start + 100), hasMore = visibleRows.length > start + evidence.length;
        const endCursor = evidence.at(-1)?.id || call.cursor;
        return route.fulfill({ json: { job: currentJob, view: call.view, totalCount: visibleRows.length, evidence, bounded: true, hasMore, endCursor, nextCursor: hasMore ? endCursor : null,
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
  if (draft) {
    await page.locator('#writerManuscriptBody').fill(manuscriptText);
    await page.locator('#writerManuscriptParts input[maxlength="240"]').fill('Local fixture part');
    await page.locator('#writerManuscriptReview').click();
    await page.locator('#writerManuscriptConfirm').check();
  }
  if (submit) await page.locator('#writerManuscriptSubmit').click();
  if (submit && expectAnalysis) await page.locator('#writerAnalysis').waitFor({ state: 'visible' });
  return { page, calls, errors, unexpectedWrites, close: () => context.close(), setJob: value => { currentJob = value; },
    ready: async () => page.locator('.writer-analysis-item').first().waitFor() };
}

test('analysis browser functional: actual paste receipt automatically enqueues once and source quotation stays private', async () => {
  const f = await fixture();
  try {
    await f.ready();
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 1);
    await f.page.locator('.writer-analysis-item button').click();
    await f.page.locator('blockquote').waitFor();
    assert.equal(await f.page.locator('blockquote').textContent(), quoteText);
    assert.equal(await f.page.locator('#writerAnalysis script').count(), 0);
    assert.deepEqual(f.unexpectedWrites, []);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('writer sees cited AI findings before dense structural rows and can switch views on mobile', async () => {
  const rows = [makeEvidence(1, { provenance: 'structural_only', title: undefined, observation: undefined }), makeEvidence(0)];
  const f = await fixture({ rows, width: 390 });
  try {
    await f.ready();
    assert.equal(await f.page.locator('.writer-analysis-item').count(), 1);
    assert.match(await f.page.locator('.writer-analysis-item').first().textContent(), /Local fixture 1/);
    assert.equal(f.calls.find(call => call.path.endsWith(`/analyses/${ids.job}`))?.view, 'semantic');
    await f.page.locator('#writerAnalysisStructural').click();
    assert.match(await f.page.locator('.writer-analysis-item').first().textContent(), /Structural information/);
    assert.equal(await f.page.locator('#writerAnalysisPageCount').textContent(), '1–1 of 1');
    await f.page.locator('#writerAnalysisSemantic').click();
    assert.match(await f.page.locator('.writer-analysis-item').first().textContent(), /Local fixture 1/);
    assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('analysis browser functional: previously published analysis opens without reupload or paid generation', async () => {
  const f = await fixture({ draft: false, submit: false, expectAnalysis: false, hook: call => {
    if (call.method === 'GET' && call.path.endsWith(`/stories/${ids.work}/manuscripts`)) return {
      body: { workId: ids.work, items: [{ id: ids.manuscript, workId: ids.work, version: 3, locale: 'ko', contentHash: 'a'.repeat(64) }] }
    };
    if (call.method === 'GET' && call.path.endsWith(`/manuscripts/${ids.manuscript}/analyses`)) return {
      body: { manuscriptVersionId: ids.manuscript, items: [makeJob()] }
    };
    return null;
  } });
  try {
    await f.page.locator('#writerAnalysisRestore').click();
    await f.ready();
    assert.equal(await f.page.locator('#writerGenerationEntry').isVisible(), true);
    assert.equal(await f.page.locator('#writerAnalysisStart').isVisible(), false);
    assert.equal(f.calls.some(call => call.path.endsWith(`/stories/${ids.work}/manuscripts`)), true);
    assert.equal(f.calls.some(call => call.path.endsWith(`/manuscripts/${ids.manuscript}/analyses`)), true);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('analysis browser functional: failed upload cannot enqueue', async () => {
  const f = await fixture({ expectAnalysis: false, hook: call => call.path.endsWith('/manuscripts/paste') ?
    { status: 500, body: { error: { code: 'UPLOAD_FAILED' } } } : null });
  try {
    await f.page.waitForFunction(() => !document.getElementById('writerManuscriptSubmit').disabled);
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 0);
    assert.equal(await f.page.locator('#writerAnalysis').isVisible(), false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('analysis browser functional: double submit click enqueues once', async () => {
  const pasteSeen = deferred(), releasePaste = deferred();
  const f = await fixture({ submit: false, hook: async call => {
    if (call.path.endsWith('/manuscripts/paste')) { pasteSeen.resolve(); await releasePaste.promise; }
  } });
  try {
    await f.page.evaluate(() => { const button = document.getElementById('writerManuscriptSubmit'); button.click(); button.click(); });
    await pasteSeen.promise;
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/manuscripts/paste')).length, 1);
    releasePaste.resolve(); await f.ready();
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 1);
    assert.deepEqual(f.unexpectedWrites, []);
  } finally { releasePaste.resolve(); await f.close(); }
});

test('analysis browser functional: UI locale change during upload ignores late receipt', async () => {
  const pasteSeen = deferred(), releasePaste = deferred();
  const f = await fixture({ submit: false, hook: async call => {
    if (call.path.endsWith('/manuscripts/paste')) { pasteSeen.resolve(); await releasePaste.promise; }
  } });
  try {
    await f.page.locator('#writerManuscriptSubmit').click(); await pasteSeen.promise;
    await f.page.evaluate(() => window.dispatchEvent(new Event('lumina:localechange')));
    releasePaste.resolve();
    await f.page.waitForFunction(() => !Object.hasOwn(document.getElementById('writerManuscriptSubmit').dataset, 'writerWasDisabled'));
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 0);
    assert.equal(await f.page.locator('#writerAnalysis').isVisible(), false);
    assert.deepEqual(f.errors, []);
  } finally { releasePaste.resolve(); await f.close(); }
});

test('analysis browser functional: reload restores a known job by GET without a second enqueue', async () => {
  const f = await fixture();
  try {
    await f.ready();
    await f.page.goto(origin + '/creator-studio/?reload=1#writer-manuscript');
    await f.page.waitForFunction(() => window.LuminaCreatorAnalysis && !document.getElementById('writerManuscriptWork').disabled);
    await f.page.locator('#writerManuscriptWork').selectOption(ids.work);
    await f.ready();
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 1);
    assert.equal(f.calls.filter(call => call.method === 'GET' && call.path.endsWith(`/analyses/${ids.job}`)).length >= 2, true);
    assert.deepEqual(f.unexpectedWrites, []);
  } finally { await f.close(); }
});

for (const [name, change] of [
  ['account', () => {
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'other-token', user: { id: 'other-owner' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' }));
  }],
  ['work', () => { const select = document.getElementById('writerManuscriptWork'); select.value = ''; select.dispatchEvent(new Event('change')); }],
  ['source locale', () => { const select = document.getElementById('writerManuscriptLocale'); select.value = 'ja'; select.dispatchEvent(new Event('change')); }]
]) {
  test(`analysis browser functional: ${name} change during upload ignores late receipt`, async () => {
    const pasteSeen = deferred(), releasePaste = deferred();
    const f = await fixture({ submit: false, hook: async call => {
      if (call.path.endsWith('/manuscripts/paste')) { pasteSeen.resolve(); await releasePaste.promise; }
    } });
    try {
      await f.page.locator('#writerManuscriptSubmit').click(); await pasteSeen.promise;
      await f.page.evaluate(change);
      releasePaste.resolve();
      await f.page.waitForFunction(() => !Object.hasOwn(document.getElementById('writerManuscriptSubmit').dataset, 'writerWasDisabled'));
      assert.equal(f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/analyses')).length, 0);
      assert.equal(await f.page.locator('#writerAnalysis').isVisible(), false);
      assert.deepEqual(f.errors, []);
    } finally { releasePaste.resolve(); await f.close(); }
  });
}

test('analysis browser functional: full cursor traversal and reread do not enqueue or approve again', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => makeEvidence(index));
  const f = await fixture({ width: 400, rows });
  try {
    await f.ready();
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
    await f.ready(); await f.page.locator('.writer-analysis-item button').click();
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
      await f.ready();
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

async function recoveryFixture(options = {}) {
  const f = await fixture({ draft: false, submit: false, job: makeRecoverableJob(), generationProfile: makeGenerationResponse(), ...options });
  try {
    await f.page.locator('#writerAnalysisRestore').click();
    await f.page.waitForFunction(() => !document.getElementById('writerAnalysis').hidden && !document.getElementById('writerAnalysisCheck').disabled);
    return f;
  } catch (error) { await f.close(); throw error; }
}

test('profile recovery browser: restored failed analysis waits for an explicit single local recovery and opens draft review', async () => {
  const seen = deferred(), release = deferred();
  const f = await recoveryFixture({ hook: async call => {
    if (call.path.endsWith('/recover-profile')) { seen.resolve(); await release.promise; }
  } });
  try {
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal(await f.page.locator('#writerAnalysisRecover').isVisible(), true);
    assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), /does not request manuscript AI again or approve/);
    await f.page.locator('#writerAnalysisStructural').click();
    await f.page.waitForFunction(() => !document.getElementById('writerAnalysisStructural').disabled);
    await f.page.evaluate(() => { const button = document.getElementById('writerAnalysisRecover'); button.click(); button.click(); });
    await seen.promise;
    assert.equal(await f.page.locator('#writerAnalysisRecover').isDisabled(), true);
    assert.equal(await f.page.locator('#writerAnalysisCheck').isDisabled(), true);
    await f.page.evaluate(() => document.getElementById('writerAnalysisCheck').click());
    const writes = f.calls.filter(call => call.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `/api/v1/me/creator-studio/analyses/${ids.job}/recover-profile`);
    assert.deepEqual(JSON.parse(writes[0].body), { expectedSourceContentHash: sourceHash });
    assert.match(writes[0].headers['content-type'], /application\/json/);
    release.resolve();
    await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
    assert.equal(await f.page.locator('#writerAnalysisRecover').isVisible(), false);
    assert.equal(await f.page.locator('#writerAnalysisStart').isVisible(), false);
    assert.equal(await f.page.locator('.writer-generation-section').count(), 8);
    assert.equal(await f.page.locator('#writerGenerationApprove').isDisabled(), false);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith(`/analyses/${ids.job}`)).at(-1).view, 'semantic');
    assert.ok(f.calls.some(call => call.method === 'GET' && call.path.endsWith('/generation-profile')));
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

for (const [name, overrides] of [
  ['no capability', { profileRecovery: undefined }],
  ['not available', { profileRecovery: { available: false, mode: 'local_settings_only' } }],
  ['wrong mode', { profileRecovery: { available: true, mode: 'provider_retry' } }],
  ['provider unknown', { budget: { usageUnobserved: true }, errorCode: 'provider_outcome_unknown' }],
  ['partial paragraphs', { progress: { ...makeJob().progress, completedParagraphs: 0 } }],
  ['partial chunks', { progress: { ...makeJob().progress, completedChunks: 0 } }]
]) {
  test(`profile recovery browser: ${name} never offers a recovery button`, async () => {
    const f = await recoveryFixture({ job: makeRecoverableJob(overrides) });
    try {
      assert.equal(await f.page.locator('#writerAnalysisRecover').isVisible(), false);
      assert.equal(await f.page.locator('#writerAnalysisRecoverState').isVisible(), false);
      assert.equal(await f.page.locator('#writerAnalysisStart').isVisible(), false);
      await f.page.locator('#writerAnalysisCheck').click();
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisCheck').disabled);
      assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

for (const [name, reply] of [
  ['conflict', { status: 409, body: { error: { code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE', message: 'Private diagnostic' } } }],
  ['server failure', { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Private diagnostic' } } }],
  ['lost acknowledgement', { abort: true }],
  ['malformed acknowledgement', { body: { job: makeJob() } }],
  ['foreign source', { body: makeJob({ sourceContentHash: 'c'.repeat(64) }) }],
  ['nonterminal acknowledgement', { body: makeJob({ status: 'running', phase: 'extracting' }) }]
]) {
  test(`profile recovery browser: ${name} keeps safe GET checks and explicit retry without restarting analysis`, async () => {
    let broken = true;
    const f = await recoveryFixture({ hook: call => call.path.endsWith('/recover-profile') && broken ? reply : null });
    try {
      await f.page.locator('#writerAnalysisRecover').click();
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisRecover').disabled && document.getElementById('writerAnalysisRecoverState').textContent.includes('Check the status'));
      assert.doesNotMatch(await f.page.locator('#writerAnalysisRecoverState').textContent(), /Private diagnostic|ANALYSIS_PROFILE|INTERNAL_ERROR/);
      assert.equal(await f.page.locator('#writerAnalysisStart').isVisible(), false);
      assert.equal(await f.page.locator('#writerGenerationModal').isVisible(), false);
      await f.page.locator('#writerAnalysisCheck').click();
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisCheck').disabled);
      await f.page.evaluate(() => window.dispatchEvent(new Event('lumina:localechange')));
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisCheck').disabled);
      assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
      assert.equal(f.calls.some(call => call.path.endsWith('/generation-profile')), false);
      broken = false;
      await f.page.locator('#writerAnalysisRecover').click();
      await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
      assert.equal(f.calls.filter(call => call.method !== 'GET').length, 2);
      assert.ok(f.calls.filter(call => call.method !== 'GET').every(call => call.path.endsWith('/recover-profile')));
      assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

for (const [name, change] of [
  ['account', () => {
    localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'other-token', user: { id: 'other-owner' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' }));
  }],
  ['work', () => { const select = document.getElementById('writerManuscriptWork'); select.value = ''; select.dispatchEvent(new Event('change')); }],
  ['source locale', () => { const select = document.getElementById('writerManuscriptLocale'); select.value = 'ja'; select.dispatchEvent(new Event('change')); }]
]) {
  test(`profile recovery browser: ${name} switch ignores a late completed recovery`, async () => {
    const seen = deferred(), release = deferred(), replied = deferred();
    const f = await recoveryFixture({ hook: async call => {
      if (call.path.endsWith('/recover-profile')) { seen.resolve(); await release.promise; replied.resolve(); return { body: makeJob() }; }
    } });
    try {
      await f.page.locator('#writerAnalysisRecover').click(); await seen.promise;
      await f.page.evaluate(change);
      release.resolve(); await replied.promise;
      await f.page.locator('#writerAnalysis').waitFor({ state: 'hidden' });
      assert.equal(await f.page.locator('#writerAnalysisEvidence').textContent(), '');
      assert.equal(await f.page.locator('#writerAnalysisRecoverState').textContent(), '');
      assert.equal(await f.page.locator('#writerGenerationModal').isVisible(), false);
      assert.equal(f.calls.some(call => call.path.endsWith('/generation-profile')), false);
      assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
      assert.deepEqual(f.errors, []);
    } finally { release.resolve(); await f.close(); }
  });
}

test('profile recovery browser: locale switch fences the old reply and never automatically retries recovery', async () => {
  const seen = deferred(), release = deferred(), replied = deferred();
  const f = await recoveryFixture({ hook: async call => {
    if (call.path.endsWith('/recover-profile')) { seen.resolve(); await release.promise; replied.resolve(); return { body: makeJob() }; }
  } });
  try {
    await f.page.locator('#writerAnalysisRecover').click(); await seen.promise;
    await f.page.evaluate(() => window.luminaI18n.setLocale('ja-JP'));
    release.resolve(); await replied.promise;
    await f.page.waitForFunction(() => !document.getElementById('writerAnalysisRecover').disabled);
    assert.equal(await f.page.locator('#writerAnalysisRecover').textContent(), '生成設定を復旧');
    assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), /復旧の完了を確認できません/);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
    assert.equal(f.calls.some(call => call.path.endsWith('/generation-profile')), false);
    assert.equal(await f.page.locator('#writerGenerationModal').isVisible(), false);
    assert.deepEqual(f.errors, []);
  } finally { release.resolve(); await f.close(); }
});

test('profile recovery browser: a lost successful reply is reconciled by GET only', async () => {
  const f = await recoveryFixture({ hook: call => call.path.endsWith('/recover-profile') ? { abort: true } : null });
  try {
    await f.page.locator('#writerAnalysisRecover').click();
    await f.page.waitForFunction(() => !document.getElementById('writerAnalysisRecover').disabled);
    f.setJob(makeJob());
    await f.page.locator('#writerAnalysisCheck').click();
    await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
    assert.equal(await f.page.locator('#writerAnalysisRecover').isVisible(), false);
    assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), /Review it before applying/);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('generation draft browser: edited summary discards old interpretations but keeps evidence and fixed flags', async () => {
  const initial = makeGenerationResponse();
  const f = await recoveryFixture({ generationProfile: initial });
  try {
    await f.page.locator('#writerAnalysisRecover').click();
    await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
    await f.page.locator('.writer-generation-section[data-key="writing_style"] textarea').fill('My corrected writing style.');
    await f.page.locator('.writer-generation-section[data-key="canon"] button').first().click();
    await f.page.locator('.writer-generation-section[data-key="branch_behavior"] textarea').fill('My corrected branching rule.');
    await f.page.locator('#writerGenerationSave').click();
    await f.page.waitForFunction(() => !document.getElementById('writerGenerationSave').disabled);
    const patches = f.calls.filter(call => call.method === 'PATCH');
    assert.equal(patches.length, 1);
    const saved = JSON.parse(patches[0].body).settings.sections;
    assert.equal(saved[0].decision, 'edited');
    assert.equal(saved[0].value.summary, 'My corrected writing style.');
    assert.deepEqual(saved[0].value.observations, []);
    assert.deepEqual(saved[0].value.categories, []);
    assert.equal(saved[0].value.imitationBoundary, 'approved_work_only');
    assert.deepEqual(saved[0].evidence, initial.profile.draftSettings.sections[0].evidence);
    assert.equal(saved[2].decision, 'accepted');
    assert.deepEqual(saved[2].value.observations, initial.profile.draftSettings.sections[2].value.observations);
    assert.deepEqual(saved[5].value.observations, []);
    assert.equal(saved[5].value.selectedChoiceMustMateriallyDiverge, true);
    assert.equal(saved[5].value.maximumSuggestedChoices, 3);
    assert.equal(f.calls.some(call => call.path.endsWith('/approve')), false);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('generation draft browser: explicit author approval sends one JSON object per save and approval', async () => {
  const f = await recoveryFixture();
  try {
    await f.page.locator('#writerAnalysisRecover').click();
    await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
    assert.equal(f.calls.filter(call => call.path.endsWith('/approve')).length, 0);
    for (const article of await f.page.locator('.writer-generation-section').all())
      await article.locator('.writer-generation-decisions button').first().click();
    await f.page.locator('.writer-generation-section[data-key="writing_style"] textarea').fill('Author revised third-person voice.');
    await f.page.locator('#writerGenerationApprove').click();
    await f.page.waitForFunction(() => document.getElementById('writerGenerationReviewState').textContent.includes('active'));
    const patch = f.calls.find(call => call.method === 'PATCH');
    const approval = f.calls.find(call => call.path.endsWith('/approve'));
    assert.equal(typeof JSON.parse(patch.body), 'object');
    assert.deepEqual(JSON.parse(approval.body), { expectedDraftFingerprint: 'b'.repeat(64) });
    const style = JSON.parse(patch.body).settings.sections.find(section => section.key === 'writing_style');
    assert.equal(style.value.summary, 'Author revised third-person voice.');
    assert.deepEqual(style.value.observations, []);
    assert.deepEqual(style.value.categories, []);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith('/approve')).length, 1);
    assert.equal(await f.page.locator('#writerGenerationApprove').isDisabled(), true);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const [locale, label, boundary, loading, completed, failed, unknown] of [
  ['ko-KR', '생성 설정 복구', /자동 승인하지/, /자동으로 적용되지/, /검토 후 직접 적용/, /복구하지 못했습니다/, /완료 여부를 확인하지/],
  ['en-US', 'Recover generation settings', /approve settings automatically/, /not be applied automatically/, /Review it before applying/, /Could not recover/, /Recovery could not be confirmed/],
  ['ja-JP', '生成設定を復旧', /自動承認は行いません/, /自動適用は行いません/, /確認してから適用/, /復旧できませんでした/, /完了を確認できません/],
  ['zh-CN', '恢复生成设置', /不会自动批准/, /不会自动应用/, /核对后再应用/, /无法恢复/, /无法确认恢复是否完成/],
  ['zh-Hant', '復原生成設定', /不會自動核准/, /不會自動套用/, /核對後再套用/, /無法復原/, /無法確認復原是否完成/]
]) for (const width of [390, 1280]) {
  test(`profile recovery browser visual: ${locale} ${width} localized recovery states fit without overflow`, async () => {
    assert.match(artifacts || '', /^E:[/\\]/i, 'explicit E artifact directory required');
    const seen = deferred(), release = deferred(); let mode = 'failed';
    const f = await recoveryFixture({ locale, width, hook: async call => {
      if (!call.path.endsWith('/recover-profile')) return null;
      if (mode === 'failed') return { status: 409, body: { error: { code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' } } };
      if (mode === 'unknown') return { abort: true };
      seen.resolve(); await release.promise;
    } });
    try {
      assert.equal(await f.page.locator('#writerAnalysisRecover').textContent(), label);
      assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), boundary);
      await f.page.locator('#writerAnalysisRecover').click();
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisRecover').disabled);
      assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), failed);
      mode = 'unknown'; await f.page.locator('#writerAnalysisRecover').click();
      await f.page.waitForFunction(() => !document.getElementById('writerAnalysisRecover').disabled);
      assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), unknown);
      mode = 'success'; await f.page.locator('#writerAnalysisRecover').click(); await seen.promise;
      assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), loading);
      await f.page.locator('#writerAnalysisRecover').scrollIntoViewIfNeeded();
      const metrics = await f.page.locator('#writerAnalysis').evaluate(panel => {
        const button = panel.querySelector('#writerAnalysisRecover'), status = panel.querySelector('#writerAnalysisRecoverState');
        const rect = button.getBoundingClientRect(), state = status.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, buttonWidth: rect.width,
          buttonHeight: rect.height, buttonFits: button.scrollWidth <= button.clientWidth + 1, statusFits: status.scrollWidth <= status.clientWidth + 1,
          statusBelowButton: state.top >= rect.bottom, hitTarget: hit === button || button.contains(hit),
          rawCopyKeys: /writerAnalysis\.|recoverReady|recoverLoading|ANALYSIS_PROFILE/.test(panel.innerText) };
      });
      assert.ok(metrics.documentWidth <= width + 1);
      assert.ok(metrics.buttonWidth >= 40 && metrics.buttonHeight >= 40);
      assert.equal(metrics.buttonFits, true); assert.equal(metrics.statusFits, true);
      assert.equal(metrics.statusBelowButton, true); assert.equal(metrics.hitTarget, true); assert.equal(metrics.rawCopyKeys, false);
      await mkdir(artifacts, { recursive: true });
      const name = `${locale}-${width}-profile-recovery`;
      await f.page.screenshot({ path: path.join(artifacts, name + '.png') });
      await writeFile(path.join(artifacts, name + '.json'), JSON.stringify({ locale, ...metrics,
        caption: 'Local API fixtures only. No provider calls, automatic approval or publication.' }, null, 2));
      release.resolve(); await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
      assert.match(await f.page.locator('#writerAnalysisRecoverState').textContent(), completed);
      assert.equal(f.calls.filter(call => call.method !== 'GET').length, 3);
      assert.ok(f.calls.filter(call => call.method !== 'GET').every(call => call.path.endsWith('/recover-profile')));
      assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
    } finally { release.resolve(); await f.close(); }
  });
}

async function visualReviewFixture(options = {}) {
  const generationProfile = options.generationProfile || makeVisualGenerationResponse();
  const f = await fixture({ draft: false, submit: false, generationProfile, ...options });
  try {
    await f.page.locator('#writerAnalysisRestore').click();
    if (generationProfile.profile.status === 'approved') {
      await f.page.waitForFunction(() => [
        '이 원고의 생성 설정이 적용되었습니다.', 'Generation settings are active for this manuscript.',
        'この原稿の生成設定を適用しました。', '已应用此稿件的生成设置。', '已套用此稿件的生成設定。'
      ].includes(document.getElementById('writerGenerationReviewState').textContent));
      await f.page.locator('#writerGenerationReviewOpen').click();
    }
    await f.page.locator('#writerGenerationModal:not(.is-hidden)').waitFor();
    await f.page.locator('.writer-generation-visual-world').waitFor();
    return f;
  } catch (error) { await f.close(); throw error; }
}
const visualArticle = (page, key) => page.locator(`.writer-generation-section[data-key="${key}"]`);
const visualInput = (article, key) => article.locator(`[data-visual-field="${key}"]`);
const visualPatches = f => f.calls.filter(call => call.method === 'PATCH');
async function saveVisualReview(f) {
  await f.page.locator('#writerGenerationSave').click();
  await f.page.waitForFunction(() => !document.getElementById('writerGenerationSave').disabled);
}

async function visualGeometry(page) {
  return page.locator('#writerGenerationModal').evaluate(overlay => {
    const modal = overlay.querySelector('.modal-card'), rect = modal.getBoundingClientRect();
    const measure = node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return { tag: node.tagName, id: node.id, className: node.className, left: box.left, right: box.right, width: box.width,
        clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, cssWidth: style.width, minWidth: style.minWidth,
        maxWidth: style.maxWidth, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, gridColumns: style.gridTemplateColumns };
    };
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overlay: measure(overlay), modal: measure(modal),
      overflowing: [...modal.querySelectorAll('*')].filter(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && (box.left < rect.left || box.right > rect.right || node.scrollWidth > node.clientWidth + 1);
      }).slice(0, 24).map(measure) };
  });
}

test('visual review browser: diagnose original mobile padding overflow and verify exact repaired geometry', { timeout: 30000 }, async () => {
  assert.match(artifacts || '', /^E:[/\\]/i, 'explicit E artifact directory required');
  await mkdir(artifacts, { recursive: true });
  for (const width of [390, 400]) {
    const f = await visualReviewFixture({ width });
    try {
      // Reproduce the pre-fix layout without changing any source or weakening fit checks.
      await f.page.locator('#writerGenerationModal').evaluate(overlay => {
        overlay.style.padding = '22px'; overlay.style.gridTemplateColumns = 'none';
        const modal = overlay.querySelector('.modal-card'); modal.style.minWidth = 'auto'; modal.style.maxWidth = 'none';
        overlay.querySelectorAll('.writer-generation-section').forEach(node => { node.style.minWidth = 'auto'; });
      });
      const before = await visualGeometry(f.page);
      await f.page.screenshot({ path: path.join(artifacts, `overflow-${width}-before.png`) });
      await f.page.locator('#writerGenerationModal').evaluate(overlay => {
        overlay.style.removeProperty('padding'); overlay.style.removeProperty('grid-template-columns');
        const modal = overlay.querySelector('.modal-card'); modal.style.removeProperty('min-width'); modal.style.removeProperty('max-width');
        overlay.querySelectorAll('.writer-generation-section').forEach(node => { node.style.removeProperty('min-width'); });
      });
      const after = await visualGeometry(f.page);
      await f.page.screenshot({ path: path.join(artifacts, `overflow-${width}-after.png`) });
      await writeFile(path.join(artifacts, `overflow-${width}-metrics.json`), JSON.stringify({ before, after }, null, 2));
      console.log('visual overflow geometry', JSON.stringify({ width, before: before.modal, after: after.modal }));
      assert.equal(before.overlay.paddingLeft, '22px'); assert.equal(before.modal.width, width - 16);
      assert.ok(before.modal.right > width + 1, 'original mobile grid overflows viewport');
      assert.equal(after.overlay.paddingLeft, '8px'); assert.equal(after.modal.left, 8); assert.equal(after.modal.right, width - 8);
      assert.ok(after.modal.scrollWidth <= after.modal.clientWidth + 1);
      assert.ok(after.documentWidth <= width + 1);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('visual review browser: cast validation is inline, trim-aware and enforced for removed sections before transport', async () => {
  const f = await visualReviewFixture();
  try {
    const cast = visualArticle(f.page, 'visual_cast');
    await cast.getByRole('button', { name: 'Add character', exact: true }).click();
    const added = cast.locator('.writer-generation-visual-character').last();
    const name = visualInput(added, 'name'), appearance = visualInput(added, 'appearance'), errors = added.locator('.writer-generation-visual-error');
    assert.equal(await errors.nth(0).isVisible(), true); assert.equal(await errors.nth(1).isVisible(), true);
    assert.equal(await errors.nth(0).textContent(), 'Enter a character name.');
    assert.equal(await errors.nth(1).textContent(), "Enter this character's appearance.");
    await name.fill('  '); await appearance.fill(' ');
    await cast.locator('.writer-generation-decisions button').nth(2).click(); await saveVisualReview(f);
    assert.equal(visualPatches(f).length, 0);
    await f.page.locator('#writerGenerationApprove').click();
    await f.page.waitForFunction(() => !document.getElementById('writerGenerationApprove').disabled);
    assert.equal(f.calls.some(call => call.path.endsWith('/approve')), false);
    await name.fill(' Mira '); await appearance.fill(' Red coat ');
    assert.equal(await errors.nth(0).textContent(), 'Each character needs a unique name.');
    assert.equal(await visualInput(cast, 'name').first().getAttribute('aria-invalid'), 'true');
    await saveVisualReview(f); assert.equal(visualPatches(f).length, 0);
    await name.fill(' New character ');
    assert.equal(await errors.nth(0).isVisible(), false); assert.equal(await errors.nth(1).isVisible(), false);
    assert.equal(await visualInput(cast, 'name').first().getAttribute('aria-invalid'), 'false');
    await cast.locator('.writer-generation-decisions button').nth(2).click(); await saveVisualReview(f);
    const saved = JSON.parse(visualPatches(f)[0].body).settings.sections[7];
    assert.equal(saved.decision, 'removed');
    assert.deepEqual(saved.value.characters, [
      { name: 'Mira', appearance: 'Silver hair and a green coat.' }, { name: 'New character', appearance: 'Red coat' }
    ]);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('visual review browser: accepted world and cast use the real API helper and keep existing fields', async () => {
  const initial = makeVisualGenerationResponse(), f = await visualReviewFixture({ generationProfile: initial });
  try {
    for (const key of ['visual_direction', 'visual_cast']) await visualArticle(f.page, key).locator('.writer-generation-decisions button').first().click();
    await saveVisualReview(f);
    assert.equal(visualPatches(f).length, 1);
    const patch = visualPatches(f)[0], payload = JSON.parse(patch.body);
    assert.equal(typeof payload, 'object'); assert.equal(typeof payload.settings, 'object');
    assert.match(patch.headers['content-type'], /application\/json/);
    assert.equal(patch.headers.authorization, 'Bearer local-fixture-token');
    for (const index of [6, 7]) {
      assert.equal(payload.settings.sections[index].decision, 'accepted');
      assert.deepEqual(payload.settings.sections[index].value, { ...initial.profile.draftSettings.sections[index].value, visualReviewVersion: 'story-visual-review-v1' });
      assert.deepEqual(payload.settings.sections[index].evidence, initial.profile.draftSettings.sections[index].evidence);
    }
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 1);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('visual review browser: unsafe editable text, cast add/remove and removed sections retain the complete request', async () => {
  const f = await visualReviewFixture();
  try {
    const unsafe = '<script>window.visualInjected=1</script><img src=x onerror=alert(1)>';
    const world = visualArticle(f.page, 'visual_direction'), cast = visualArticle(f.page, 'visual_cast');
    for (const key of ['era', 'artStyle', 'palette']) await visualInput(world, key).fill(unsafe);
    await visualInput(world, 'prohibited').fill('No logos\nNo neon');
    await visualInput(cast, 'name').fill(unsafe); await visualInput(cast, 'appearance').fill(unsafe);
    await cast.getByRole('button', { name: 'Add character', exact: true }).click();
    await visualInput(cast, 'name').nth(1).fill('Temporary character');
    await cast.getByRole('button', { name: 'Remove character', exact: true }).nth(1).click();
    assert.equal(await cast.locator('.writer-generation-visual-character').count(), 1);
    assert.match(await world.locator('header p').textContent(), /Use my edit/);
    assert.match(await cast.locator('header p').textContent(), /Use my edit/);
    for (const article of [world, cast]) await article.locator('.writer-generation-decisions button').nth(2).click();
    await saveVisualReview(f);
    const saved = JSON.parse(visualPatches(f)[0].body).settings.sections;
    assert.equal(saved[6].decision, 'removed'); assert.equal(saved[7].decision, 'removed');
    assert.deepEqual(saved[6].value.visualBible, { era: unsafe, artStyle: unsafe, palette: unsafe, prohibited: ['No logos', 'No neon'] });
    assert.deepEqual(saved[7].value.characters, [{ name: unsafe, appearance: unsafe }]);
    assert.deepEqual(saved[6].value.observations, ['Previous AI interpretation.']);
    assert.deepEqual(saved[7].value.observations, ['Previous AI interpretation.']);
    assert.equal(await f.page.locator('#writerGenerationSections script, #writerGenerationSections img').count(), 0);
    assert.equal(await f.page.evaluate(() => window.visualInjected), undefined);
    assert.equal(await visualInput(visualArticle(f.page, 'visual_cast'), 'name').inputValue(), unsafe);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('visual review browser: empty cast and bounded 16-row additions save without silently dropping seeded overflow', async () => {
  const empty = await visualReviewFixture({ generationProfile: makeVisualGenerationResponse({ characters: [] }) });
  try {
    const cast = visualArticle(empty.page, 'visual_cast'), add = cast.getByRole('button', { name: 'Add character', exact: true });
    assert.match(await cast.textContent(), /No characters added/);
    for (let i = 0; i < 16; i++) await add.click();
    assert.equal(await cast.locator('.writer-generation-visual-character').count(), 16); assert.equal(await add.isDisabled(), true);
    for (let i = 0; i < 16; i++) await cast.getByRole('button', { name: 'Remove character', exact: true }).last().click();
    await saveVisualReview(empty);
    const saved = JSON.parse(visualPatches(empty)[0].body).settings.sections[7];
    assert.deepEqual(saved.value.characters, []); assert.equal(saved.decision, 'edited');
    assert.equal(saved.value.visualReviewVersion, 'story-visual-review-v1');
    assert.deepEqual(empty.errors, []);
  } finally { await empty.close(); }
  const characters = Array.from({ length: 17 }, (_, i) => ({ name: `Source character ${i}`, appearance: 'Source appearance' }));
  const overflow = await visualReviewFixture({ generationProfile: makeVisualGenerationResponse({ characters }) });
  try {
    const cast = visualArticle(overflow.page, 'visual_cast');
    assert.equal(await cast.locator('.writer-generation-visual-character').count(), 17);
    assert.equal(await visualInput(cast, 'name').last().inputValue(), 'Source character 16');
    assert.equal(await cast.getByRole('button', { name: 'Add character', exact: true }).isDisabled(), true);
    await saveVisualReview(overflow); assert.equal(visualPatches(overflow).length, 0);
    assert.match(await overflow.page.locator('#writerGenerationStatus').textContent(), /entries have been retained/);
    await cast.getByRole('button', { name: 'Remove character', exact: true }).first().click(); await saveVisualReview(overflow);
    assert.deepEqual(JSON.parse(visualPatches(overflow)[0].body).settings.sections[7].value.characters, characters.slice(1));
    assert.deepEqual(overflow.errors, []);
  } finally { await overflow.close(); }
});

test('visual review browser: native lengths, prohibited validation and summary clearing remain scoped', async () => {
  const initial = makeVisualGenerationResponse(); initial.profile.draftSettings.sections[6].value.categories = ['Old category'];
  const f = await visualReviewFixture({ generationProfile: initial });
  try {
    const world = visualArticle(f.page, 'visual_direction'), cast = visualArticle(f.page, 'visual_cast');
    for (const [article, key, limit] of [[world, 'era', 800], [world, 'artStyle', 800], [world, 'palette', 800], [cast, 'name', 120], [cast, 'appearance', 600]]) {
      assert.equal(await visualInput(article, key).getAttribute('maxlength'), String(limit));
    }
    const prohibited = visualInput(world, 'prohibited');
    for (const value of [Array.from({ length: 25 }, () => 'No logos').join('\n'), 'x'.repeat(241)]) {
      await prohibited.fill(value); await saveVisualReview(f);
      assert.equal(visualPatches(f).length, 0); assert.equal(await prohibited.inputValue(), value);
      assert.equal(await prohibited.getAttribute('aria-invalid'), 'true');
    }
    const lines = Array.from({ length: 24 }, () => 'x'.repeat(240));
    await prohibited.fill(lines.join('\n')); await world.locator('.writer-generation-summary').fill('Corrected visual summary');
    await saveVisualReview(f);
    const saved = JSON.parse(visualPatches(f)[0].body).settings.sections[6];
    assert.deepEqual(saved.value.visualBible.prohibited, lines);
    assert.deepEqual(saved.value.observations, []); assert.deepEqual(saved.value.categories, []);
    assert.deepEqual(saved.evidence, initial.profile.draftSettings.sections[6].evidence);
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('visual review browser: explicit approval locks structured fields and cast actions', async () => {
  const f = await visualReviewFixture();
  try {
    for (const article of await f.page.locator('.writer-generation-section').all()) await article.locator('.writer-generation-decisions button').first().click();
    await visualInput(visualArticle(f.page, 'visual_direction'), 'era').fill('Author-approved era');
    await f.page.locator('#writerGenerationApprove').click();
    await f.page.waitForFunction(() => document.getElementById('writerGenerationApprove').disabled &&
      document.getElementById('writerGenerationReviewState').textContent.includes('active'));
    assert.equal(visualPatches(f).length, 1);
    assert.equal(f.calls.filter(call => call.path.endsWith('/approve')).length, 1);
    for (const control of await f.page.locator('.writer-generation-visual-field textarea, .writer-generation-visual-icon').all()) assert.equal(await control.isDisabled(), true);
    assert.equal(JSON.parse(visualPatches(f)[0].body).settings.sections[6].value.visualReviewVersion, 'story-visual-review-v1');
    assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const [locale, labels, add, remove, requiredName, requiredAppearance, unique] of [
  ['ko-KR', ['시대와 배경', '그림 스타일', '색상 기준', '피해야 할 시각 요소', '이름', '외형'], '등장인물 추가', '등장인물 삭제', '등장인물 이름을 입력해 주세요.', '등장인물 외형을 입력해 주세요.', '등장인물마다 다른 이름을 입력해 주세요.'],
  ['en-US', ['Era and setting', 'Art style', 'Color palette', 'Prohibited visual elements', 'Name', 'Appearance'], 'Add character', 'Remove character', 'Enter a character name.', "Enter this character's appearance.", 'Each character needs a unique name.'],
  ['ja-JP', ['時代と舞台', '画風', '配色', '避ける視覚要素', '名前', '外見'], '登場人物を追加', '登場人物を削除', '登場人物の名前を入力してください。', '登場人物の外見を入力してください。', '登場人物ごとに異なる名前を入力してください。'],
  ['zh-CN', ['时代与背景', '画风', '配色', '禁止的视觉元素', '姓名', '外观'], '添加人物', '删除人物', '请输入人物姓名。', '请输入人物外观。', '每位人物的姓名必须不同。'],
  ['zh-Hant', ['時代與背景', '畫風', '配色', '禁止的視覺元素', '姓名', '外觀'], '新增人物', '刪除人物', '請輸入人物姓名。', '請輸入人物外觀。', '每位人物的姓名必須不同。']
]) for (const width of [390, 400, 1280]) {
  test(`visual review browser: ${locale} ${width} labeled controls fit in draft and approved views`, { timeout: 30000 }, async () => {
    const initial = makeVisualGenerationResponse({ visualBible: {
      era: 'UnbrokenSourceText'.repeat(40), artStyle: 'Ink illustration', palette: 'Green, silver and red', prohibited: ['No logos']
    } });
    for (const approved of [false, true]) {
      const profile = structuredClone(initial);
      if (approved) { profile.profile.status = 'approved'; profile.profile.approvedSettings = structuredClone(profile.profile.draftSettings); }
      const f = await visualReviewFixture({ locale, width, generationProfile: profile });
      try {
        assert.deepEqual(await f.page.locator('.writer-generation-visual-field > span').allTextContents(), labels);
        const cast = visualArticle(f.page, 'visual_cast');
        assert.equal(await cast.getByRole('button', { name: add, exact: true }).count(), 1);
        assert.equal(await cast.getByRole('button', { name: remove, exact: true }).count(), 1);
        for (const control of await f.page.locator('.writer-generation-visual-field textarea, .writer-generation-visual-icon').all()) assert.equal(await control.isDisabled(), approved);
        for (const key of ['visual_direction', 'visual_cast']) {
          const article = visualArticle(f.page, key);
          await article.locator('.writer-generation-visual-field').first().evaluate(node => node.scrollIntoView({ block: 'center' }));
          const metrics = await article.evaluate(node => {
            const modal = document.querySelector('#writerGenerationModal .modal-card'), rect = modal.getBoundingClientRect();
            const fits = item => {
              const box = item.getBoundingClientRect();
              return box.left >= rect.left - 1 && box.right <= rect.right + 1 && item.scrollWidth <= item.clientWidth + 1;
            };
            return { documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
              modalFits: rect.left >= 0 && rect.right <= innerWidth + 1 && modal.scrollWidth <= modal.clientWidth + 1,
              labelsFit: [...node.querySelectorAll('.writer-generation-visual-field > span')].every(fits),
              fieldsFit: [...node.querySelectorAll('.writer-generation-visual-field textarea')].every(fits),
              labelsAboveFields: [...node.querySelectorAll('.writer-generation-visual-field')].every(label =>
                label.querySelector('span').getBoundingClientRect().bottom <= label.querySelector('textarea').getBoundingClientRect().top),
              headingsClear: [...node.querySelectorAll('.writer-generation-visual-character-heading')].every(header =>
                header.querySelector('h4').getBoundingClientRect().right <= header.querySelector('button').getBoundingClientRect().left),
              iconTargets: [...node.querySelectorAll('.writer-generation-visual-icon')].every(button => {
                const box = button.getBoundingClientRect(); return box.width >= 44 && box.height >= 44;
              }) };
          });
          if (artifacts) {
            assert.match(artifacts, /^E:[/\\]/i, 'visual artifacts must stay on E');
            await mkdir(artifacts, { recursive: true });
            await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-${key}-${approved ? 'approved' : 'draft'}.png`) });
            await writeFile(path.join(artifacts, `${locale}-${width}-${key}-${approved ? 'approved' : 'draft'}-metrics.json`),
              JSON.stringify({ locale, width, key, approved, fits: metrics, geometry: await visualGeometry(f.page) }, null, 2));
          }
          for (const [name, value] of Object.entries(metrics)) assert.equal(value, true, `${locale} ${width} ${key} ${name}`);
        }
        if (!approved) {
          await cast.getByRole('button', { name: add, exact: true }).click();
          const row = cast.locator('.writer-generation-visual-character').last(), errors = row.locator('.writer-generation-visual-error');
          assert.equal(await errors.nth(0).textContent(), requiredName); assert.equal(await errors.nth(1).textContent(), requiredAppearance);
          assert.equal(await errors.nth(0).isVisible(), true); assert.equal(await errors.nth(1).isVisible(), true);
          await visualInput(row, 'name').fill(' Mira '); assert.equal(await errors.nth(0).textContent(), unique);
          await row.evaluate(node => node.scrollIntoView({ block: 'center' }));
          const inlineFits = await row.evaluate(node => [...node.querySelectorAll('.writer-generation-visual-error')].every(error =>
            error.scrollWidth <= error.clientWidth + 1 && error.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom));
          assert.equal(inlineFits, true, `${locale} ${width} inline validation fits`);
          if (artifacts) await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-cast-inline-errors.png`) });
          await visualInput(row, 'name').fill('Other author character'); await visualInput(row, 'appearance').fill('Red coat');
          assert.equal(await errors.nth(0).isVisible(), false); assert.equal(await errors.nth(1).isVisible(), false);
        }
        assert.equal(f.calls.some(call => call.method !== 'GET'), false);
        assert.deepEqual(f.unexpectedWrites, []); assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    }
  });
}

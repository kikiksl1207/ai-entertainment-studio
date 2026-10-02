import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Main must opt in; importing the file never starts a browser or contacts the backend.
const enabled = process.env.CREATOR_BRANCH_VISUAL_REVIEW_BROWSER_QA === '1';
const root = new URL('..', import.meta.url);
const widths = [390, 400, 1280];
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const workId = '10000000-0000-4000-8000-000000000001';
const secondWorkId = '10000000-0000-4000-8000-000000000002';
const releaseId = '20000000-0000-4000-8000-000000000001';
const resultId = '30000000-0000-4000-8000-000000000001';
const secondResultId = '30000000-0000-4000-8000-000000000002';
const batchId = '40000000-0000-4000-8000-000000000001';
const cursor = '50000000-0000-4000-8000-000000000001';
const origin = 'https://creator-branch-fixture.invalid';
const snippets = {
  ko: '\uADF8\uB294 \uBB38\uC744 \uC5F4\uACE0 \uC624\uB798\uB41C \uBB34\uB300\uB97C \uBC14\uB77C\uBCF4\uC558\uB2E4. \uC57D\uC18D\uD55C \uC2DC\uAC04\uC774 \uB2E4\uAC00\uC624\uACE0 \uC788\uC5C8\uB2E4.',
  en: 'She opened the door and looked at the old stage. The time they had agreed upon was drawing near.',
  ja: '\u5F7C\u5973\u306F\u6249\u3092\u958B\u3051\u3001\u53E4\u3044\u821E\u53F0\u3092\u898B\u3064\u3081\u305F\u3002\u7D04\u675F\u306E\u6642\u9593\u304C\u8FD1\u3065\u3044\u3066\u3044\u305F\u3002',
  'zh-Hans': '\u5979\u63A8\u5F00\u95E8\uFF0C\u671B\u5411\u53E4\u8001\u7684\u821E\u53F0\u3002\u7EA6\u5B9A\u7684\u65F6\u95F4\u5373\u5C06\u5230\u6765\u3002',
  'zh-Hant': '\u5979\u63A8\u958B\u9580\uFF0C\u671B\u5411\u53E4\u8001\u7684\u821E\u53F0\u3002\u7D04\u5B9A\u7684\u6642\u9593\u5373\u5C07\u5230\u4F86\u3002',
};
const titles = { ko: '\uACF5\uC720 \uBD84\uAE30 \uAC80\uD1A0', en: 'Shared Branch Review', ja: '\u5171\u6709\u5206\u5C90\u306E\u78BA\u8A8D',
  'zh-Hans': '\u5171\u4EAB\u5206\u652F\u5BA1\u9605', 'zh-Hant': '\u5171\u4EAB\u5206\u652F\u5BE9\u95B1' };

function bootstrap(config) {
  const qa = window.__branchQa = { ...config, owner: 'fixture-author', epoch: 1, calls: [], pending: [], forbidden: [], hold: null, fail: null,
    empty: false, paging: false, corrupt: false, batch: null, twoRows: false };
  const identity = () => ({ ownerId: qa.owner, epoch: qa.epoch });
  const isCurrent = value => Boolean(value?.ownerId === qa.owner && value.epoch === qa.epoch);
  const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  const forbidden = message => { qa.forbidden.push(message); throw new Error(message); };
  window.fetch = async () => forbidden('No real API fetch is allowed');
  window.LuminaCreatorStudioApi = { identity, isCurrent, fetch: async (url, options) => {
    const address = new URL(url, location.href), parts = address.pathname.split('/'), method = options.method || 'GET';
    let kind;
    if (method === 'GET' && parts.length === 6 && parts[5] === 'stories') kind = 'catalog';
    else if (method === 'GET' && parts.length === 8 && parts[7] === 'shared-branches') kind = 'list';
    else if (method === 'GET' && parts.length === 10 && parts[9] === 'visual-review' && !address.search) kind = 'detail';
    else if (method === 'POST' && parts.length === 11 && parts[10] === 'drafts') kind = 'save';
    else if (method === 'POST' && parts.length === 13 && parts[12] === 'approve') kind = 'approve';
    else return forbidden('Unexpected route: ' + method + ' ' + url);
    if (!isCurrent(options.identity) || options._retried !== true) return forbidden('Unbound owner or automatic retry');
    qa.calls.push({ kind, url, body: structuredClone(options.body || null), identity: structuredClone(options.identity) });
    let data;
    if (kind === 'catalog') {
      if (address.searchParams.get('locale') !== document.documentElement.lang || address.searchParams.get('limit') !== '30') return forbidden('Wrong catalog parameters');
      data = { items: [
        { workId: qa.workId, title: { value: qa.title }, publication: { published: true, activeReleaseId: qa.releaseId } },
        { workId: qa.secondWorkId, title: { value: 'Second owner work' }, publication: { published: true, activeReleaseId: qa.releaseId } },
        { workId: qa.cursor, title: { value: 'Unpublished private work' }, publication: { published: false, activeReleaseId: null } },
      ], nextCursor: null };
    } else if (kind === 'list') {
      if (address.searchParams.get('limit') !== '8') return forbidden('Wrong list limit');
      const next = address.searchParams.has('cursor');
      data = { contract: 'story-shared-branch-visual-list-v1', workId: parts[6], releaseId: qa.releaseId, releaseChecksum: 'c'.repeat(64),
        items: qa.empty || qa.paging && !next ? [] : [{ sharedResultId: qa.resultId, title: qa.title, locale: document.documentElement.lang,
          sourceChecksum: 'a'.repeat(64), profilePinHash: 'b'.repeat(64), status: qa.batch?.status || 'unreviewed' }], nextCursor: qa.paging && !next ? qa.cursor : null };
      if (qa.twoRows && data.items.length) data.items.push({ ...data.items[0], sharedResultId: qa.secondResultId, title: qa.title + ' / 2', status: 'unreviewed' });
    } else if (kind === 'detail') {
      data = { contract: 'story-shared-branch-visual-review-v1', workId: parts[6], sharedResultId: parts[8], locale: document.documentElement.lang,
        sourceChecksum: 'a'.repeat(64), profilePinHash: 'b'.repeat(64), title: qa.title, prose: qa.prose, proposedPrompt: qa.prompt,
        currentBatch: qa.batch?.sharedResultId === parts[8] ? qa.batch : null, proposalApproved: false, generationStarted: false, published: false };
    } else if (kind === 'save') {
      const body = options.body;
      if (Object.keys(body).sort().join(',') !== 'expectedProfilePinHash,expectedSourceChecksum,idempotencyKey,promptText') return forbidden('Wrong save body');
      qa.batch = { contract: 'story-branch-visual-review-batch-v1', batchId: qa.batchId, workId: parts[6], sharedResultId: qa.resultId,
        sourceChecksum: body.expectedSourceChecksum, profilePinHash: body.expectedProfilePinHash, batchChecksum: 'd'.repeat(64),
        batchVersion: 1, revision: 1, status: 'draft', promptText: body.promptText, promptSha256: await digest(body.promptText),
        approvedAt: null, generationStarted: false, published: false };
      data = structuredClone(qa.batch); if (qa.corrupt) data.promptSha256 = 'e'.repeat(64);
    } else {
      if (options.body.sceneReviewed !== true || options.body.expectedBatchChecksum !== qa.batch.batchChecksum || parts[11] !== qa.batchId) return forbidden('Approval is not bound to the reviewed draft');
      qa.batch = { ...qa.batch, status: 'approved', revision: 2, approvedAt: '2026-10-01T00:00:00.000Z' }; data = qa.batch;
    }
    if (qa.hold === kind) await new Promise(resolve => qa.pending.push(resolve));
    if (qa.fail === kind) { qa.fail = null; throw new Error('Uncertain synthetic response'); }
    if (qa.fail === '503:' + kind) return new Response(JSON.stringify({ code: 'FEATURE_DISABLED' }), { status: 503 });
    return new Response(JSON.stringify(data), { status: kind === 'save' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  } };
}

test('actual mounted branch review: responsive five-language prose, safe text and approval lifecycle', { skip: !enabled, timeout: 240000 }, async t => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'E:/Codex/LuminaStage/qa-browsers';
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  process.env.TEMP = process.env.TMP = 'E:/Codex/LuminaStage/qa-tmp';
  const require = createRequire(import.meta.url);
  // Read the already bundled library only. Browser executable, caches, temp files and evidence stay on E:.
  const { chromium } = require(process.env.CREATOR_BRANCH_PLAYWRIGHT_MODULE || 'C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const executablePath = process.env.STORY_UI_BROWSER || 'E:/Codex/LuminaStage/qa-browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
  assert.match(executablePath, /^E:[/\\]/i);
  const assets = new Map();
  for (const path of ['styles.css', 'styles/creator-studio.css', 'pages/creator-branch-visual-review.css', 'pages/creator-branch-visual-review.js']) assets.set('/' + path, await readFile(new URL(path, root), 'utf8'));
  const entry = await readFile(new URL('creator-studio/index.html', root), 'utf8');
  const host = entry.match(/<section id="writerBranchVisualReview"[^>]*><\/section>/)?.[0]; assert.ok(host);
  const browser = await chromium.launch({ executablePath, headless: true, env: { ...process.env }, args: ['--disable-background-networking', '--disable-component-update'] });
  try {
    for (const width of widths) for (const locale of locales) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      const attack = '<img src="https://invalid.example/attack" onerror="window.__branchXss=true">';
      const prose = (snippets[locale] + '\n\n').repeat(90) + attack + '\n' + 'LongUnbrokenText'.repeat(100);
      const prompt = (snippets[locale] + '\n').repeat(12) + '\n</textarea>' + attack;
      const config = { workId, secondWorkId, releaseId, resultId, secondResultId, batchId, cursor, title: titles[locale] + ' ' + '<b>Literal title</b>', prose, prompt };
      const json = JSON.stringify(config).replace(/</g, '\\u003c');
      const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/creator-studio.css"><link rel="stylesheet" href="/pages/creator-branch-visual-review.css"></head><body class="page-creator-studio"><div id="studioShell" class="studio-shell"><aside class="studio-sidebar"><nav class="studio-nav"><button data-section="writer-manuscript">Creator Studio</button><button data-section="other">Other</button></nav></aside><main class="studio-main"><section id="writer-manuscript" class="studio-section is-active"><select id="writerManuscriptWork" hidden><option value="draft-work">Draft work</option></select><select id="writerManuscriptLocale" hidden><option value="ko">ko</option></select>${host}</section></main></div><script>(${bootstrap.toString()})(${json})</script><script src="/pages/creator-branch-visual-review.js"></script></body></html>`;
      const fixtureHtml = html.replace('</section></main>', '</section><button id="branchExternalFocus">Outside Review</button></main>');
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { requests.push(request.url()); await route.abort(); return; }
        if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: fixtureHtml }); return; }
        if (assets.has(url.pathname)) { await route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: assets.get(url.pathname) }); return; }
        requests.push(request.url()); await route.abort();
      });
      try {
        await page.goto(origin); const action = name => page.locator(`[data-branch-action="${name}"]`);
        const contrast = async selector => page.locator(selector).evaluate(node => {
          const style = getComputedStyle(node);
          const luminance = color => {
            const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
          };
          const foreground = luminance(style.color), background = luminance(style.backgroundColor);
          return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        });
        const ready = async () => {
          await action('catalog').focus(); await page.keyboard.press('Enter'); await page.locator('[data-branch-work]:not([disabled])').waitFor();
          assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'catalog');
          await page.locator('[data-branch-work]').selectOption(workId);
          await action('list').focus(); await page.keyboard.press('Enter'); await action('open').first().waitFor();
          assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'list');
          await action('open').first().focus(); await page.keyboard.press('Enter'); await page.locator('[data-branch-prompt]:not([readonly])').waitFor();
          assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'open:' + resultId);
        };
        await ready();
        assert.equal(await page.locator('.branch-review-prose').textContent(), prose);
        assert.equal(await page.locator('[data-branch-prompt]').inputValue(), prompt);
        assert.equal(await page.locator('#writerBranchVisualReview img').count(), 0);
        assert.equal(await page.evaluate(() => Boolean(window.__branchXss)), false);
        assert.equal(await action('approve').isDisabled(), true);
        assert.ok(await contrast('[data-branch-action="catalog"]') >= 4.5);
        assert.ok(await contrast('[data-branch-prompt]') >= 4.5);
        await action('catalog').hover(); assert.ok(await contrast('[data-branch-action="catalog"]') >= 4.5);
        const layout = await page.evaluate(() => {
          const source = document.querySelector('.branch-review-source'), guide = document.querySelector('.branch-review-guidance'), prose = document.querySelector('.branch-review-prose');
          const a = source.getBoundingClientRect(), b = guide.getBoundingClientRect(), style = getComputedStyle(prose);
          const overflows = Array.from(document.querySelectorAll('#writerBranchVisualReview button, #writerBranchVisualReview textarea, #writerBranchVisualReview label, #writerBranchVisualReview h3, #writerBranchVisualReview h4')).filter(node => {
            const rect = node.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 2;
          }).map(node => node.tagName);
          return { source: { top: a.top, right: a.right, bottom: a.bottom }, guide: { top: b.top, left: b.left }, font: style.fontSize,
            lineHeight: style.lineHeight, proseScrollable: prose.scrollHeight > prose.clientHeight + 2, overflows };
        });
        assert.equal(layout.font, '18px'); assert.equal(layout.lineHeight, '32.4px'); assert.equal(layout.proseScrollable, false); assert.deepEqual(layout.overflows, []);
        if (width === 1280) { assert.ok(Math.abs(layout.source.top - layout.guide.top) < 2); assert.ok(layout.guide.left >= layout.source.right); }
        else assert.ok(layout.guide.top >= layout.source.bottom);
        await page.locator('.branch-review-heading').scrollIntoViewIfNeeded();
        const shot = await page.screenshot({ path: `E:/Codex/LuminaStage/qa-artifacts/creator-branch-review-${locale}-${width}.png` }); assert.ok(shot.length > 15000);
        const ends = await page.evaluate(() => {
          const prose = document.querySelector('.branch-review-prose'), prompt = document.querySelector('[data-branch-prompt]');
          const sidebar = document.querySelector('.studio-sidebar');
          const safeBottom = getComputedStyle(sidebar).position === 'fixed' ? Math.min(innerHeight, sidebar.getBoundingClientRect().top) : innerHeight;
          window.scrollTo({ top: prose.getBoundingClientRect().bottom + scrollY - safeBottom + 24, behavior: 'instant' });
          const proseBottom = prose.getBoundingClientRect().bottom;
          window.scrollTo({ top: prompt.getBoundingClientRect().bottom + scrollY - safeBottom + 24, behavior: 'instant' });
          return { proseBottom, promptBottom: prompt.getBoundingClientRect().bottom, height: safeBottom, nestedScroll: prompt.scrollHeight > prompt.clientHeight + 2 };
        });
        assert.ok(ends.proseBottom > 0 && ends.proseBottom <= ends.height + 1, JSON.stringify(ends)); assert.ok(ends.promptBottom > 0 && ends.promptBottom <= ends.height + 1, JSON.stringify(ends)); assert.equal(ends.nestedScroll, false);
        await action('save').focus(); await page.keyboard.press('Enter'); await page.locator('[data-branch-ack]:not([disabled])').waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'ack');
        assert.equal(await action('approve').isDisabled(), true); await page.locator('[data-branch-ack]').check(); assert.equal(await action('approve').isEnabled(), true);
        const composition = await page.evaluate(() => {
          const input = document.querySelector('[data-branch-prompt]'); input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
          const retained = document.querySelector('[data-branch-prompt]') === input;
          input.value += '\nIME'; input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
          const checked = document.querySelector('[data-branch-ack]').checked, disabled = document.querySelector('[data-branch-action="approve"]').disabled;
          input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); return { retained, checked, disabled };
        });
        assert.deepEqual(composition, { retained: true, checked: false, disabled: true });
        await page.locator('[data-branch-prompt]').fill(prompt + '\nChanged'); assert.equal(await page.locator('[data-branch-ack]').isChecked(), false); assert.equal(await action('approve').isDisabled(), true);
        await action('save').click(); await page.locator('[data-branch-ack]:not([disabled])').waitFor(); await page.locator('[data-branch-ack]').check(); await action('approve').focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__branchQa.calls.filter(call => call.kind === 'approve').length === 1 && !document.querySelector('[data-branch-prompt]').readOnly);
        assert.equal(await action('approve').isDisabled(), true);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'status');
        const posts = await page.evaluate(() => window.__branchQa.calls.filter(call => ['save', 'approve'].includes(call.kind)));
        assert.deepEqual(posts.map(call => call.kind), ['save', 'save', 'approve']); assert.equal(posts[0].body.promptText, prompt); assert.equal(posts[1].body.promptText, prompt + '\nChanged');

        if (locale === 'en') {
          await page.locator('[data-branch-prompt]').fill('Uncertain save text'); await page.evaluate(() => { window.__branchQa.fail = 'save'; });
          await action('save').click(); await action('retry').waitFor(); assert.equal(await page.locator('[data-branch-prompt]').getAttribute('readonly'), '');
          assert.ok(await contrast('[data-branch-prompt]') >= 4.5); assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'status');
          await action('retry').click(); await page.locator('[data-branch-ack]:not([disabled])').waitFor();
          const attempts = await page.evaluate(() => window.__branchQa.calls.filter(call => call.kind === 'save').slice(-2)); assert.deepEqual(attempts[0].body, attempts[1].body);
          await page.locator('[data-branch-prompt]').fill('Dirty navigation');
          let dialogCount = 0; const cancel = async dialog => { dialogCount++; assert.match(dialog.message(), /Discard/); await dialog.dismiss(); };
          page.on('dialog', cancel); await page.locator('[data-branch-work]').selectOption(secondWorkId); page.off('dialog', cancel);
          assert.equal(dialogCount, 1); assert.equal(await page.locator('[data-branch-work]').inputValue(), workId); assert.equal(await page.locator('[data-branch-prompt]').inputValue(), 'Dirty navigation');
          await page.evaluate(() => { window.__branchQa.epoch++; window.dispatchEvent(new Event('storage')); }); assert.equal(await page.locator('.branch-review-prose').count(), 0);
          await ready(); await page.evaluate(() => { window.__branchQa.paging = true; }); await action('list').click();
          assert.equal(await action('next').isEnabled(), true); assert.equal(await action('open').count(), 0); await action('next').click(); await action('open').waitFor();
          await page.evaluate(() => { window.__branchQa.fail = '503:list'; }); await action('list').click(); await page.waitForFunction(() => document.querySelector('.branch-review-state').textContent.includes('unavailable'));
          assert.equal(await action('next').count(), 0); assert.equal(await action('approve').count(), 0);
          await page.evaluate(() => { window.__branchQa.fail = null; window.__branchQa.paging = false; window.__branchQa.empty = true; }); await action('list').click();
          await page.waitForFunction(() => document.querySelector('.branch-review-state').textContent.includes('no reviewable'));
          assert.equal(await action('next').isDisabled(), true);
          await page.evaluate(() => { window.__branchQa.empty = false; window.__branchQa.twoRows = true; }); await action('list').click();
          const secondOpen = page.locator(`[data-branch-action="open"][data-branch-id="${secondResultId}"]`);
          await secondOpen.focus(); await page.keyboard.press('Enter'); await page.locator('[data-branch-prompt]:not([readonly])').waitFor();
          assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'open:' + secondResultId);
          await page.evaluate(() => { window.__branchQa.hold = 'detail'; }); await secondOpen.focus(); await page.keyboard.press('Enter');
          await page.waitForFunction(() => window.__branchQa.pending.length === 1);
          assert.equal(await page.evaluate(() => document.activeElement.dataset.branchFocus), 'status');
          await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'branchExternalFocus');
          await page.evaluate(() => { window.__branchQa.hold = null; window.__branchQa.pending.splice(0).forEach(resolve => resolve()); });
          await page.locator('[data-branch-prompt]:not([readonly])').waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'branchExternalFocus');
          await page.evaluate(() => { window.__branchQa.hold = 'detail'; }); await secondOpen.focus(); await page.keyboard.press('Enter');
          await page.waitForFunction(() => window.__branchQa.pending.length === 1);
          await page.evaluate(() => { window.__branchQa.owner = 'other-owner'; window.dispatchEvent(new Event('storage')); window.__branchQa.pending.splice(0).forEach(resolve => resolve()); });
          await page.waitForTimeout(30); assert.equal(await page.locator('.branch-review-prose').count(), 0); assert.equal(await page.locator('[data-branch-prompt]').count(), 0);
          await page.evaluate(() => { window.__branchQa.hold = null; document.getElementById('studioShell').hidden = true; });
          assert.equal(await page.locator('.branch-review-prose').count(), 0);
        }
        assert.deepEqual(errors, []); assert.deepEqual(requests, []); assert.deepEqual(await page.evaluate(() => window.__branchQa.forbidden), []);
        t.diagnostic(`Controlled-response mounted UI passed: ${locale}, ${width}px`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

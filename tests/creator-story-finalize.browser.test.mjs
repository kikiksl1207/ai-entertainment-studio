import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.FINALIZE_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-finalize-20260928';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const widths = [1280, 390, 400];
const mime = { '.css': 'text/css', '.js': 'text/javascript' };
const source = await readFile(join(root, 'creator-studio/index.html'), 'utf8');
const entry = source.slice(source.indexOf('<section id="writerFinalEntry"'), source.indexOf('</section>', source.indexOf('<section id="writerFinalEntry"')) + '</section>'.length);
const modal = source.slice(source.indexOf('<div class="studio-modal is-hidden" id="writerFinalModal"'), source.indexOf('<script src="/pages/creator-studio.js', source.indexOf('<div class="studio-modal is-hidden" id="writerFinalModal"')));

const bootstrap = `
  const sections = ['writing_style', 'scene_scale', 'canon', 'timeline', 'visual_direction', 'visual_cast', 'narrative_devices', 'branch_behavior'];
  const parts = Array.from({ length: 265 }, (_, i) => ({ partKey: 'p' + (i + 1), title: '합성 장면 ' + (i + 1),
    endingExcerpt: '이 장면의 마지막 문장 ' + (i + 1), nextPartTitle: i === 264 ? null : '합성 장면 ' + (i + 2) }));
  const resumed = JSON.parse(sessionStorage.getItem('finalizeResume') || 'null');
  const qa = window.__finalizeQa = { locale: 'ko', hash: 'h', fingerprint: 'fingerprint', checksum: 'checksum',
    workId: 'work', analysisId: 'analysis', releaseId: 'release', sceneIds: null,
    profilePinHash: 'c'.repeat(64),
    failPreview: false, failRetry: false, reviewUnavailable: false, reviewStatus: 'current', canReset: false,
    ready: false, profileStatus: 'approved', ownerId: 'synthetic-author', epoch: 1, manuscriptId: 'manuscript',
    jobStatus: null, serverLabels: {}, issues: [], calls: [], parts };
  qa.resume = resumed;
  window.luminaI18n = { getLocale: () => qa.locale, setLocale: value => { qa.locale = value; window.dispatchEvent(new Event('lumina:localechange')); } };
  window.LuminaCreatorAnalysis = { completed: () => ({ manuscriptVersionId: qa.manuscriptId, workId: qa.workId, analysisJobId: qa.analysisId, identity: { ownerId: qa.ownerId, epoch: qa.epoch } }) };
  window.LuminaCreatorStudioApi = { isCurrent: identity => identity?.ownerId === qa.ownerId && identity?.epoch === qa.epoch, fetch: async (url, options = {}) => {
    qa.calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url.endsWith('/linear-draft/' + qa.manuscriptId) && qa.failPreview) {
      qa.failPreview = false;
      return { ok: false, status: 503, json: async () => ({ code: 'TEMPORARY_FAILURE' }) };
    }
    if (url.endsWith('/retry-choices') && qa.failRetry) {
      qa.failRetry = false;
      return { ok: false, status: 503, json: async () => ({ code: 'TEMPORARY_FAILURE' }) };
    }
    let data;
    if (url.endsWith('/linear-draft/' + qa.manuscriptId)) data = { manuscriptVersionId: qa.manuscriptId, manuscriptHash: qa.hash, analysisJobId: qa.analysisId,
      parts, scenes: parts.map((part, index) => ({ partKey: part.partKey, sceneId: qa.sceneIds?.[index] || 'scene-' + part.partKey,
        choiceCount: index < (qa.resume?.job?.completedParts ?? (qa.jobStatus === 'completed' ? 265 : 31)) ? 3 : 1,
        originalLabel: qa.serverLabels[part.partKey] || '' })), issues: qa.issues,
      ...(qa.importedVisualReferences ? { importedVisualReferences: qa.importedVisualReferences } : {}),
      review: qa.resume?.submitted || qa.jobStatus ? { reviewId: 'review', state: 'submitted', revision: 5 } : null,
      consent: qa.reviewStatus === 'consent_changed' ? { active: true, revision: 2 } : qa.resume?.consented ? { active: true, revision: 1 } : null,
      releaseId: qa.resume?.releaseId || (qa.jobStatus ? qa.releaseId : null),
      choiceJob: qa.resume?.job || (qa.jobStatus ? { status: qa.jobStatus, completedParts: qa.jobStatus === 'completed' ? 265 : 31, totalParts: 265,
        errorCode: qa.jobError || (qa.reviewStatus === 'reset_ready' ? 'STUDIO_CHOICES_REPREPARATION_READY' : null) } : null),
      choiceWorkerAvailable: qa.resume?.workerAvailable, ready: qa.ready };
    else if (url.endsWith('/generation-profile')) data = { workId: qa.workId, manuscript: { id: qa.manuscriptId }, analysis: { id: qa.analysisId },
      profile: { status: qa.profileStatus, approvedFingerprint: qa.fingerprint,
        approvedSettings: { schemaVersion: 'creator-generation-profile-v1', kind: 'story', sections: sections.map(key => ({ key, decision: 'accepted', value: { summary: '합성 분석' } })) },
        draftSettings: { schemaVersion: 'creator-generation-profile-v1', kind: 'story', sections: sections.map(key => ({ key, decision: 'accepted', value: { summary: '합성 분석' } })) } } };
    else if (url.endsWith('/choice-review')) {
      if (qa.reviewUnavailable) return { ok: false, status: 503, json: async () => ({ code: 'PRIVATE_DIAGNOSTIC' }) };
      data = { releaseId: qa.releaseId, status: qa.reviewStatus, code: null, canReset: qa.canReset,
        expectedManuscriptHash: qa.hash, expectedApprovedFingerprint: qa.fingerprint,
        expectedProfilePinHash: qa.profilePinHash, expectedReleaseChecksum: qa.checksum,
        resetRequiredScenes: qa.reviewStatus === 'settings_changed' ? (qa.mixedConsent ? 265 : 234) : 0,
        preparedScenes: qa.jobStatus === 'completed' ? 265 : 31, generationStarted: false };
      if (qa.mixedConsent && qa.reviewStatus === 'settings_changed') data.resetConsentReview = {
        consentId: '30000000-0000-4000-8000-000000000001', consentRevision: 2,
        batchHash: qa.consentBatchHash || 'b'.repeat(64), ...(qa.resetConsentOverride || {}) };
      if (qa.reviewStatus === 'consent_changed') data.consentReview = { canReapprove: true,
        consentId: '30000000-0000-4000-8000-000000000001', consentRevision: 2, batchHash: 'b'.repeat(64),
        scenes: parts.map((part, index) => ({ partKey: part.partKey, sceneId: qa.sceneIds[index],
          choices: [1, 2, 3].map(position => ({ position, label: 'Saved choice ' + position + ' ' + 'Longword'.repeat(12),
            routeKind: position === 1 ? 'writer_original' : 'generation_required' })) })) };
    }
    else if (url.endsWith('/reapprove-choices')) {
      qa.reviewStatus = 'current'; qa.ready = true;
      data = { releaseId: qa.releaseId, status: 'current', generationStarted: false, reapprovedScenes: 265, idempotentReplay: false };
    }
    else if (url.endsWith('/reset-choices')) {
      qa.reviewStatus = 'reset_ready'; qa.canReset = false; qa.checksum = 'reset-checksum'; qa.jobStatus = 'failed'; qa.ready = false;
      data = { releaseId: qa.releaseId, status: 'reset_ready', resetScenes: qa.mixedConsent ? 265 : 234, generationStarted: false,
        nextAction: 'explicit_retry_required', idempotentReplay: false };
    }
    else if (url.endsWith('/retry-choices')) { qa.jobStatus = 'queued'; qa.reviewStatus = 'current'; data = { status: 'queued' }; }
    else if (url.endsWith('/style-consent') && qa.resume) {
      qa.resume.consented = true;
      sessionStorage.setItem('finalizeResume', JSON.stringify(qa.resume));
      data = { status: 'active' };
    }
    else if (url.endsWith('/materialize') && qa.resume) {
      qa.resume.releaseId = 'release';
      qa.resume.job = { status: 'queued', completedParts: 0, totalParts: parts.length };
      sessionStorage.setItem('finalizeResume', JSON.stringify(qa.resume));
      data = { releaseId: 'release', scenes: parts.map(part => ({ partKey: part.partKey, originalLabel: '' })) };
    }
    else throw new Error('Unexpected synthetic API: ' + url);
    return { ok: true, json: async () => structuredClone(data) };
  } };
`;

function server() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (pathname === '/__finalize-qa') {
        const document = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/creator-studio.css"><link rel="stylesheet" href="/pages/creator-story-choice-consent-review.css"></head><body class="page-creator-studio"><main>${entry}</main>${modal}<script>${bootstrap}</script><script src="/pages/creator-story-choice-consent-review.js"></script><script src="/pages/creator-story-finalize.js"></script></body></html>`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(document);
        return;
      }
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('not found'); }
  });
}

async function withBrowser(run) {
  await mkdir(artifacts, { recursive: true });
  const site = server();
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try { await run(browser, `http://127.0.0.1:${site.address().port}`); }
  finally { await browser.close(); await new Promise(resolve => site.close(resolve)); }
}

async function openReview(page, base) {
  await page.goto(base + '/__finalize-qa');
  await page.locator('#writerFinalEntry').waitFor({ state: 'visible' });
  await page.locator('#writerFinalOpen').click();
  await page.locator('.writer-final-part').first().waitFor();
}

async function geometry(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.writer-final-modal-card');
    const actions = card.querySelector('.modal-actions');
    const last = document.querySelector('.writer-final-part:last-child input');
    const box = card.getBoundingClientRect();
    const buttons = [...actions.querySelectorAll('button')].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right }));
    const title = document.querySelector('#writerFinalTitle');
    const close = document.querySelector('#writerFinalClose');
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, modal: { left: box.left, right: box.right, height: box.height, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight },
      title: title.getBoundingClientRect().toJSON(), titleOverflow: title.scrollWidth > title.clientWidth,
      close: close.getBoundingClientRect().toJSON(), actions: actions.getBoundingClientRect().toJSON(), buttons, last: last.getBoundingClientRect().toJSON() };
  });
}

test('renewed consent review fits five locales and desktop/mobile, cancel is readonly and approval refreshes without paid retry', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base + '/__finalize-qa');
        await page.evaluate(locale => {
          const qa = window.__finalizeQa;
          Object.assign(qa, { locale, hash: 'a'.repeat(64), fingerprint: 'd'.repeat(64), checksum: 'e'.repeat(64),
            workId: '10000000-0000-4000-8000-000000000001', manuscriptId: '10000000-0000-4000-8000-000000000002',
            analysisId: '10000000-0000-4000-8000-000000000003', releaseId: '10000000-0000-4000-8000-000000000004',
            jobStatus: 'completed', reviewStatus: 'consent_changed', ready: false,
            sceneIds: qa.parts.map((_, index) => '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')) });
          window.dispatchEvent(new Event('lumina:localechange'));
        }, locale);
        await page.locator('#writerFinalEntry').waitFor({ state: 'visible' });
        await page.locator('#writerFinalOpen').click();
        const panel = page.locator('#writerChoiceConsentReview');
        await panel.waitFor({ state: 'visible' });
        assert.equal(await panel.locator('.writer-choice-consent-label').count(), 795);
        assert.equal(await page.locator('#writerFinalPrepare').isDisabled(), true);
        assert.equal(await page.locator('#writerChoiceConsentApprove').isDisabled(), true);
        await page.locator('#writerChoiceConsentReviewed').check();
        assert.equal(await page.locator('#writerChoiceConsentApprove').isDisabled(), true);
        await page.locator('#writerChoiceConsentConfirmed').check();
        await page.locator('#writerChoiceConsentApprove').scrollIntoViewIfNeeded();
        const geometry = await panel.evaluate(node => ({ overflow: node.scrollWidth > node.clientWidth,
          controls: [...node.querySelectorAll('button,label')].some(child => child.scrollWidth > child.clientWidth + 1),
          bodyOverflow: document.documentElement.scrollWidth > innerWidth }));
        assert.deepEqual(geometry, { overflow: false, controls: false, bodyOverflow: false }, `${locale} ${width}px`);
        if (locale === 'ko') await page.screenshot({ path: join(artifacts, `choice-consent-${width}.png`) });
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('#writerChoiceConsentApprove').click();
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET').length), 0);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#writerChoiceConsentApprove').click();
        await panel.waitFor({ state: 'hidden' });
        const writes = await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET'));
        assert.deepEqual(writes.map(call => call.url.split('/').at(-1)), ['reapprove-choices']);
        assert.equal(writes[0].body.expectedConsentRevision, 2);
        assert.equal(writes[0].body.expectedBatchHash, 'b'.repeat(64));
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });
});

test('unreviewed imported image references do not become approval, public prose or automatic generation', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const mapped of [true, false]) {
      const page = await browser.newPage({ viewport: { width, height: 860 } });
      try {
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
          ? route.continue() : route.abort());
        await page.goto(base + '/__finalize-qa');
        await page.evaluate(mapped => {
          window.__finalizeQa.importedVisualReferences = { contract: 'publication-visual-reference-preview-v1',
            approvalState: 'reference_only', requiresSceneReview: true, manuscriptHash: 'h', checksum: 'reference-checksum',
            totalReferences: 9, mappedReferences: mapped ? 9 : 0, truncated: true,
            mappingState: mapped ? 'exact_source_segments' : 'unmapped_legacy',
            items: [{ sourceSceneKey: 'original-reference', promptSha256: 'd'.repeat(64),
              promptExcerpt: 'SYNTHETIC_UNAPPROVED_DIRECTION', promptTruncated: false,
              ...(mapped ? { binding: { partKey: 'p1', segmentIndexes: [0] } } : {}) }] };
        }, mapped);
        await page.locator('#writerFinalOpen').click();
        await page.locator('.writer-final-part').first().waitFor();
        await page.locator('#writerFinalPrepare').click();
        assert.equal(await page.locator('#writerFinalRights').isChecked(), false);
        assert.equal(await page.locator('#writerFinalAi').isChecked(), false);
        assert.ok(!(await page.locator('body').innerText()).includes('SYNTHETIC_UNAPPROVED_DIRECTION'));
        assert.ok((await page.evaluate(() => window.__finalizeQa.calls)).every(call => call.method === 'GET'));
        const bounds = await geometry(page);
        assert.ok(bounds.documentWidth <= width, JSON.stringify(bounds));
        if (mapped && width !== 400) await page.screenshot({ path: join(artifacts, `reference-preservation-${width}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  });
});

test('265-part final review fits desktop/mobile across five locales and keeps controls reachable', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      try {
        await openReview(page, base);
        await page.evaluate(value => window.luminaI18n.setLocale(value), locale);
        assert.equal(await page.locator('.writer-final-part').count(), 265);
        const top = await geometry(page);
        assert.equal(top.titleOverflow, false, `${width} ${locale} title clipped: ${JSON.stringify(top)}`);
        assert.ok(top.title.left >= -1 && top.title.right <= width + 1, `${width} ${locale} title outside viewport: ${JSON.stringify(top)}`);
        assert.ok(top.close.left >= -1 && top.close.right <= width + 1, `${width} ${locale} close button outside viewport: ${JSON.stringify(top)}`);
        assert.ok(top.close.height < 56, `${width} ${locale} close button wrapped: ${JSON.stringify(top)}`);
        await page.screenshot({ path: join(artifacts, `finalize-${width}-${locale}-top.png`) });
        await page.locator('.writer-final-part:last-child input').focus();
        const result = await geometry(page);
        assert.ok(result.documentWidth <= width + 1, `${width} ${locale} document clipped: ${JSON.stringify(result)}`);
        assert.ok(result.modal.left >= -1 && result.modal.right <= width + 1, `${width} ${locale} modal clipped: ${JSON.stringify(result)}`);
        for (const button of result.buttons) assert.ok(button.left >= -1 && button.right <= width + 1, `${width} ${locale} button clipped: ${JSON.stringify(result)}`);
        assert.equal(await page.locator('.writer-final-part:last-child input').evaluate(element => element === document.activeElement), true);
        await page.screenshot({ path: join(artifacts, `finalize-${width}-${locale}.png`) });
      } finally { await page.close(); }
    }
  });
});

test('dialog traps keyboard focus, restores opener and keeps a distant typed choice on locale switch', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openReview(page, base);
      assert.equal(await page.evaluate(() => document.querySelector('#writerFinalModal').contains(document.activeElement)), true);
      const input = page.locator('.writer-final-part:nth-child(200) input');
      await input.fill('작가가 직접 입력한 합성 경로');
      await input.focus();
      await page.evaluate(() => window.luminaI18n.setLocale('en'));
      assert.equal(await input.inputValue(), '작가가 직접 입력한 합성 경로');
      assert.equal(await input.evaluate(element => element === document.activeElement), true);
      await page.locator('#writerFinalClose').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#writerFinalModal').contains(document.activeElement)), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#writerFinalModal').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'writerFinalOpen');
    } finally { await page.close(); }
  });
});

test('an error from the bottom of a long review is brought into view', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openReview(page, base);
      await page.locator('.writer-final-part:last-child input').focus();
      await page.locator('#writerFinalPrepare').click();
      const message = await page.locator('#writerFinalState').evaluate(element => {
        const card = element.closest('.modal-card').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { text: element.textContent, inView: box.top >= card.top && box.bottom <= card.bottom };
      });
      assert.match(message.text, /확인란|checkbox/);
      assert.equal(message.inView, true);
    } finally { await page.close(); }
  });
});

test('preview error can be retried and failed choice preparation offers a live retry', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    page.on('dialog', dialog => dialog.accept());
    try {
      await page.goto(base + '/__finalize-qa');
      await page.evaluate(() => { window.__finalizeQa.failPreview = true; });
      await page.locator('#writerFinalOpen').click();
      await page.locator('#writerFinalState.is-danger').waitFor();
      await page.locator('#writerFinalClose').click();
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part').first().waitFor();
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => { window.__finalizeQa.jobStatus = 'failed'; });
      await page.locator('#writerFinalOpen').click();
      await page.locator('#writerFinalState.is-danger').waitFor();
      assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
      await page.locator('#writerFinalPrepare').click();
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.url.endsWith('/retry-choices'))), true);
      assert.equal(await page.locator('#writerFinalState.is-danger').count(), 0);
      assert.match(await page.locator('#writerFinalState').textContent(), /31\s*\/\s*265/);
    } finally { await page.close(); }
  });
});

test('failure, reopening, and retry remain usable in each viewport and language', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const stopped = { ko: '멈췄', en: 'stopped', ja: '停止', 'zh-Hans': '停止', 'zh-Hant': '停止' };
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      page.on('dialog', dialog => dialog.accept());
      try {
        await page.goto(base + '/__finalize-qa');
        await page.locator('#writerFinalEntry').waitFor({ state: 'visible' });
        await page.evaluate(value => {
          window.luminaI18n.setLocale(value);
          window.__finalizeQa.failPreview = true;
          window.__finalizeQa.jobStatus = 'failed';
        }, locale);
        await page.locator('#writerFinalOpen').click();
        await page.locator('#writerFinalState.is-danger').waitFor();
        assert.equal(await page.locator('.writer-final-part').count(), 0);
        await page.locator('#writerFinalClose').click();
        await page.locator('#writerFinalOpen').click();
        await page.locator('.writer-final-part').first().waitFor();
        assert.ok((await page.locator('#writerFinalState').textContent()).includes(stopped[locale]));
        const before = await geometry(page);
        assert.ok(before.documentWidth <= width + 1 && before.modal.left >= -1 && before.modal.right <= width + 1);
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
        await page.locator('#writerFinalPrepare').click();
        assert.equal(await page.evaluate(() => window.__finalizeQa.jobStatus), 'queued');
        assert.equal(await page.locator('#writerFinalState.is-danger').count(), 0);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method === 'POST').length), 1);
      } finally { await page.close(); }
    }
  });
});

test('scrolling past the long dialog does not move the writer page behind it', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openReview(page, base);
      await page.evaluate(() => {
        document.querySelector('main').style.minHeight = '3000px';
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, 500);
        const card = document.querySelector('.writer-final-modal-card');
        card.scrollTop = card.scrollHeight;
      });
      const before = await page.evaluate(() => window.scrollY);
      assert.equal(before, 500);
      await page.mouse.move(195, 400);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.scrollY), before);
      await page.evaluate(() => { document.querySelector('.writer-final-modal-card').style.overscrollBehavior = 'auto'; });
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      assert.ok((await page.evaluate(() => window.scrollY)) > before);
    } finally { await page.close(); }
  });
});

test('closing and reopening a long review retains author-entered unsent choice wording in this tab', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    try {
      await openReview(page, base);
      await page.locator('.writer-final-part:nth-child(1) input').fill('합성 원고의 첫 선택');
      await page.locator('.writer-final-part:nth-child(200) input').fill('작가가 직접 입력한 합성 경로');
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('lumina:writer-final-route-draft:')).length), 1);
      await page.locator('#writerFinalClose').click();
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part').first().waitFor();
      assert.equal(await page.locator('.writer-final-part:nth-child(1) input').inputValue(), '합성 원고의 첫 선택');
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), '작가가 직접 입력한 합성 경로');
      assert.equal(await page.locator('.writer-final-part:nth-child(201) input').inputValue(), '');
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => { window.__finalizeQa.hash = 'changed-hash'; });
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part').first().waitFor();
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), '');
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('lumina:writer-final-route-draft:')).length), 0);
      await page.locator('.writer-final-part:nth-child(200) input').fill('이 탭의 오래된 임시 문구');
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => {
        window.__finalizeQa.jobStatus = 'queued';
        window.__finalizeQa.serverLabels.p200 = '서버에서 확정된 원작 경로';
      });
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part').first().waitFor();
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), '서버에서 확정된 원작 경로');
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').isEditable(), false);
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('lumina:writer-final-route-draft:')).length), 0);
    } finally { await page.close(); }
  });
});

test('a failed retry keeps the action available without submitting consent again', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    page.on('dialog', dialog => dialog.accept());
    try {
      await page.goto(base + '/__finalize-qa');
      await page.evaluate(() => {
        window.__finalizeQa.jobStatus = 'failed';
        window.__finalizeQa.failRetry = true;
      });
      await page.locator('#writerFinalOpen').click();
      await page.locator('#writerFinalState.is-danger').waitFor();
      await page.locator('#writerFinalPrepare').click();
      assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.__finalizeQa.jobStatus), 'failed');
      await page.locator('#writerFinalPrepare').click();
      assert.equal(await page.evaluate(() => window.__finalizeQa.jobStatus), 'queued');
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method === 'POST').length), 2);
    } finally { await page.close(); }
  });
});

test('reloading the same tab recovers unsent author wording without filling other parts', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openReview(page, base);
      await page.locator('.writer-final-part:nth-child(200) input').fill('새로고침 전 작가 입력');
      await page.reload();
      await page.locator('#writerFinalEntry').waitFor({ state: 'visible' });
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part').first().waitFor();
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), '새로고침 전 작가 입력');
      assert.equal(await page.locator('.writer-final-part:nth-child(201) input').inputValue(), '');
    } finally { await page.close(); }
  });
});

test('reloading a submitted review resumes once and reports an unavailable queued worker', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    try {
      await page.goto(base + '/__finalize-qa');
      await page.evaluate(() => sessionStorage.setItem('finalizeResume', JSON.stringify({ submitted: true,
        consented: false, releaseId: null, job: null, workerAvailable: false })));
      await page.reload();
      await page.locator('#writerFinalOpen').click();
      assert.match(await page.locator('#writerFinalState').textContent(), /원고 제출이 저장/);
      await page.locator('#writerFinalReviewed').check();
      await page.locator('#writerFinalRights').check();
      await page.locator('#writerFinalAi').check();
      await page.locator('#writerFinalPrepare').click();
      assert.match(await page.locator('#writerFinalState').textContent(), /운영자 설정이 필요/);
      assert.doesNotMatch(await page.locator('#writerFinalState').textContent(), /선택지 3개가 모두 준비/);
      assert.deepEqual(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET').map(call => call.url.split('/').at(-1))),
        ['style-consent', 'materialize']);
      await page.reload();
      await page.locator('#writerFinalOpen').click();
      assert.match(await page.locator('#writerFinalState').textContent(), /운영자 설정이 필요/);
      assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
    } finally { await page.close(); }
  });
});

test('long unbroken author titles and routes do not create horizontal clipping inside the dialog', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(base + '/__finalize-qa');
      await page.evaluate(() => {
        window.__finalizeQa.parts[132].title = 'LONGTITLE'.repeat(30);
        window.__finalizeQa.parts[132].nextPartTitle = 'LONGROUTE'.repeat(30);
        window.__finalizeQa.issues = [{ severity: 'warning', summary: 'LONGWARNING'.repeat(30) }];
      });
      await page.locator('#writerFinalOpen').click();
      await page.locator('.writer-final-part:nth-child(133)').waitFor();
      const bounds = await page.locator('.writer-final-part:nth-child(133)').evaluate(element => {
        const card = element.closest('.modal-card');
        return { contentWidth: card.clientWidth, scrollWidth: card.scrollWidth };
      });
      assert.ok(bounds.scrollWidth <= bounds.contentWidth + 1, JSON.stringify(bounds));
    } finally { await page.close(); }
  });
});

async function openChoiceReview(page, base, options = {}) {
  await page.goto(base + '/__finalize-qa');
  await page.evaluate(value => { Object.assign(window.__finalizeQa, { jobStatus: 'failed' }, value); }, options);
  await page.locator('#writerFinalOpen').click();
  await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent !== '원고와 검토 상태를 확인하고 있습니다.');
  await page.locator('.writer-final-part').first().waitFor();
}

async function confirmChoiceAction(page, accept) {
  const pending = page.waitForEvent('dialog');
  const clicked = page.locator('#writerFinalPrepare').click();
  const dialog = await pending;
  const message = dialog.message();
  assert.equal(dialog.type(), 'confirm');
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clicked;
  return message;
}

test('mixed settings and consent reset fits five locales and desktop/mobile, preserves prose and needs a separate paid retry', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await openChoiceReview(page, base, { locale, mixedConsent: true, reviewStatus: 'settings_changed',
          canReset: true, jobStatus: 'completed', hash: 'a'.repeat(64), fingerprint: 'd'.repeat(64),
          checksum: 'e'.repeat(64), serverLabels: { p200: 'Author original route' } });
        assert.equal(await page.locator('.writer-final-part').count(), 265);
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
        assert.equal(await page.locator('#writerChoiceConsentReview').isVisible(), false);
        await page.locator('#writerFinalState').scrollIntoViewIfNeeded();
        const box = await geometry(page);
        const fit = await page.locator('.writer-final-modal-card').evaluate(card => ({
          card: card.scrollWidth <= card.clientWidth + 1,
          state: card.querySelector('#writerFinalState').scrollWidth <= card.querySelector('#writerFinalState').clientWidth + 1,
          button: card.querySelector('#writerFinalPrepare').scrollWidth <= card.querySelector('#writerFinalPrepare').clientWidth + 1
        }));
        assert.deepEqual(fit, { card: true, state: true, button: true }, `${width} ${locale}`);
        assert.equal(box.titleOverflow, false);
        assert.ok(box.documentWidth <= width + 1 && box.modal.left >= -1 && box.modal.right <= width + 1);
        for (const button of box.buttons) assert.ok(button.left >= -1 && button.right <= width + 1);
        const state = await page.locator('#writerFinalState').textContent();
        assert.ok(state.includes('265'));
        assert.doesNotMatch(state, /\{count\}|STUDIO_CHOICES_/);
        if (locale === 'ko') await page.screenshot({ path: join(artifacts, `choice-mixed-reset-${width}.png`) });
        const cancelled = await confirmChoiceAction(page, false);
        assert.ok(cancelled.includes('265'));
        await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        await confirmChoiceAction(page, true);
        await page.waitForFunction(() => window.__finalizeQa.reviewStatus === 'reset_ready' && !document.querySelector('#writerFinalPrepare').disabled);
        const writes = await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET'));
        assert.deepEqual(writes.map(call => call.url.split('/').at(-1)), ['reset-choices']);
        assert.deepEqual(writes[0].body, { expectedManuscriptHash: 'a'.repeat(64),
          expectedApprovedFingerprint: 'd'.repeat(64), expectedProfilePinHash: 'c'.repeat(64),
          expectedReleaseChecksum: 'e'.repeat(64), resetConfirmed: true,
          expectedConsentId: '30000000-0000-4000-8000-000000000001', expectedConsentRevision: 2,
          expectedBatchHash: 'b'.repeat(64), consentChangeConfirmed: true });
        assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), 'Author original route');
        assert.equal(await page.locator('.writer-final-part:nth-child(200) input').isEditable(), false);
        await confirmChoiceAction(page, false);
        await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.url.endsWith('/retry-choices'))), false);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });
});

test('mixed reset rejects malformed or changed consent review before any confirmation or write', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let dialogs = 0; page.on('dialog', dialog => { dialogs++; void dialog.dismiss(); });
    try {
      const initial = { locale: 'en', mixedConsent: true, reviewStatus: 'settings_changed',
        canReset: true, jobStatus: 'completed' };
      for (const override of [{ consentId: 'invalid' }, { consentRevision: '2' }, { batchHash: 'invalid' }]) {
        await openChoiceReview(page, base, { ...initial, resetConsentOverride: override });
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.match(await page.locator('#writerFinalState').textContent(), /Could not verify choices against current settings/);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      }
      for (const change of [{ consentBatchHash: 'f'.repeat(64) }, { resetConsentOverride: { consentRevision: 3 } }, { mixedConsent: false }]) {
        await openChoiceReview(page, base, initial);
        await page.evaluate(value => Object.assign(window.__finalizeQa, value), change);
        await page.locator('#writerFinalPrepare').click();
        await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent.includes('review content changed'));
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      }
      assert.equal(dialogs, 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});

test('unavailable review blocks ready and paid retry, while current complete choices stay private', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      for (const jobStatus of ['failed', 'completed']) {
        await openChoiceReview(page, base, { locale: 'en', jobStatus, ready: true, reviewUnavailable: true });
        assert.match(await page.locator('#writerFinalState').textContent(), /Could not verify choices against current settings/);
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.url.endsWith('/choice-review'))), true);
      }
      await openChoiceReview(page, base, { locale: 'en', jobStatus: 'completed', ready: true });
      assert.match(await page.locator('#writerFinalState').textContent(), /All three choices are prepared.*still private/);
      assert.equal(await page.locator('#writerFinalStage').textContent(), 'Choices prepared');
      assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
    } finally { await page.close(); }
  });
});

test('a delayed background read can be closed and reopened without reviving its old state', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      try {
        await openChoiceReview(page, base, { locale: 'en', jobStatus: 'queued' });
        await page.evaluate(() => {
          const api = window.LuminaCreatorStudioApi;
          const original = api.fetch; let hold = true;
          api.fetch = async (url, options) => {
            const response = await original(url, options);
            if (hold && url.endsWith('/choice-review')) {
              hold = false; window.__heldStatusRead = true;
              await new Promise(resolve => { window.__releaseStatusRead = resolve; });
            }
            return response;
          };
        });
        await page.waitForFunction(() => window.__heldStatusRead);
        await page.locator('#writerFinalClose').click();
        await page.evaluate(() => { window.__finalizeQa.reviewStatus = 'blocked'; });
        await page.locator('#writerFinalOpen').click();
        await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent.includes('cannot be reset or regenerated'));
        await page.evaluate(() => window.__releaseStatusRead());
        await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent.includes('cannot be reset or regenerated'));
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        const buttonStyle = await page.locator('#writerFinalPrepare').evaluate(button => {
          const style = getComputedStyle(button);
          return { backgroundImage: style.backgroundImage, cursor: style.cursor, opacity: Number(style.opacity) };
        });
        assert.deepEqual(buttonStyle, { backgroundImage: 'none', cursor: 'not-allowed', opacity: 0.6 });
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        await page.screenshot({ path: join(artifacts, `reopen-status-${width}.png`) });
      } finally { await page.close(); }
    }
  });
});

test('completion rejects wrong part mapping, incomplete scenes and malformed progress on screen', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      for (const bad of ['mapping', 'choices', 'counter', 'ready']) {
        await page.goto(base + '/__finalize-qa');
        await page.evaluate(bad => {
          const qa = window.__finalizeQa; Object.assign(qa, { locale: 'en', jobStatus: 'completed', ready: true });
          const api = window.LuminaCreatorStudioApi; const original = api.fetch;
          api.fetch = async (url, options) => {
            const response = await original(url, options);
            if (!url.endsWith('/linear-draft/manuscript')) return response;
            const value = await response.json();
            if (bad === 'mapping') value.scenes[200].partKey = value.scenes[0].partKey;
            if (bad === 'choices') value.scenes[200].choiceCount = 1;
            if (bad === 'counter') value.choiceJob.completedParts = 266;
            if (bad === 'ready') value.ready = 'true';
            return { ok: true, json: async () => value };
          };
        }, bad);
        await page.locator('#writerFinalOpen').click();
        await page.waitForFunction(() => document.querySelector('.writer-final-part'));
        assert.doesNotMatch(await page.locator('#writerFinalState').textContent(), /All three choices are prepared/);
        assert.notEqual(await page.locator('#writerFinalStage').textContent(), 'Choices prepared');
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      }
      await page.screenshot({ path: join(artifacts, 'unverified-completion-390.png') });
    } finally { await page.close(); }
  });
});

test('saved original labels become visible on background completion without losing the focused part', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openChoiceReview(page, base, { locale: 'en', jobStatus: 'queued' });
      const input = page.locator('.writer-final-part:nth-child(200) input');
      await input.focus(); assert.equal(await input.inputValue(), '');
      await page.evaluate(() => {
        const qa = window.__finalizeQa;
        qa.serverLabels.p200 = 'Read the letter before leaving';
        qa.jobStatus = 'completed'; qa.ready = true;
      });
      await page.waitForFunction(() => document.querySelector('#writerFinalStage').textContent === 'Choices prepared');
      assert.equal(await input.inputValue(), 'Read the letter before leaving');
      assert.equal(await input.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      await page.screenshot({ path: join(artifacts, 'stored-choice-refresh-390.png') });
    } finally { await page.close(); }
  });
});

test('cancelled reset makes no request; accepted reset preserves routes and never starts generation', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await openChoiceReview(page, base, { locale: 'en', reviewStatus: 'settings_changed', canReset: true,
        serverLabels: { p200: 'Author original route' } });
      assert.equal(await page.locator('#writerFinalPrepare').textContent(), 'Reset outdated choices');
      const cancelled = await confirmChoiceAction(page, false);
      assert.match(cancelled, /No AI generation starts and no cost is incurred/);
      await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      const accepted = await confirmChoiceAction(page, true);
      assert.match(accepted, /current-settings choices are preserved/);
      await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent.includes('AI generation has not started'));
      assert.deepEqual(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET').map(call => call.url.split('/').at(-1))), ['reset-choices']);
      assert.deepEqual(await page.evaluate(() => window.__finalizeQa.calls.find(call => call.url.endsWith('/reset-choices')).body),
        { expectedManuscriptHash: 'h', expectedApprovedFingerprint: 'fingerprint', expectedProfilePinHash: 'c'.repeat(64),
          expectedReleaseChecksum: 'checksum', resetConfirmed: true });
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').inputValue(), 'Author original route');
      assert.equal(await page.locator('.writer-final-part:nth-child(200) input').isEditable(), false);
      assert.equal(await page.locator('#writerFinalPrepare').textContent(), 'Retry choice preparation');
      const retry = await confirmChoiceAction(page, false);
      assert.match(retry, /requests AI generation, which may be queued and may incur a cost/);
      await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
      assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.url.endsWith('/retry-choices'))), false);
      await confirmChoiceAction(page, true);
      await page.waitForFunction(() => window.__finalizeQa.jobStatus === 'queued');
      assert.deepEqual(await page.evaluate(() => window.__finalizeQa.calls.filter(call => call.method !== 'GET').map(call => call.url.split('/').at(-1))), ['reset-choices', 'retry-choices']);
    } finally { await page.close(); }
  });
});

test('approval-required, blocked and active stale jobs expose no reset or retry action', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    try {
      for (const [reviewStatus, jobStatus, profileStatus, message] of [
        ['settings_changed', 'processing', 'approved', 'choice job is active'],
        ['settings_changed', 'queued', 'approved', 'choice job is active'],
        ['approval_required', 'failed', 'needs_review', 'Edit and approve generation settings first'],
        ['blocked', 'failed', 'approved', 'cannot be reset or regenerated']
      ]) {
        await openChoiceReview(page, base, { locale: 'en', reviewStatus, jobStatus, profileStatus });
        assert.match(await page.locator('#writerFinalState').textContent(), new RegExp(message));
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      }
    } finally { await page.close(); }
  });
});

test('unchanged settings with a new approval pin cannot reuse an old reset or paid confirmation', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      for (const reviewStatus of ['current', 'settings_changed']) {
        await openChoiceReview(page, base, { locale: 'en', reviewStatus, canReset: reviewStatus === 'settings_changed' });
        await page.evaluate(() => { window.__finalizeQa.profilePinHash = 'd'.repeat(64); });
        await page.locator('#writerFinalPrepare').click();
        await page.waitForFunction(() => document.querySelector('#writerFinalState').textContent.includes('review content changed'));
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
      }
    } finally { await page.close(); }
  });
});

test('reset and re-review copy fit desktop/mobile in every locale without inner overflow', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      try {
        await openChoiceReview(page, base, { locale, reviewStatus: 'settings_changed', canReset: true });
        for (const status of ['settings_changed', 'reset_ready', 'approval_required', 'blocked']) {
          if (status !== 'settings_changed') {
            await page.locator('#writerFinalClose').click();
            await page.evaluate(value => { window.__finalizeQa.reviewStatus = value; window.__finalizeQa.canReset = false; }, status);
            await page.locator('#writerFinalOpen').click();
            await page.locator('.writer-final-part').first().waitFor();
          }
          await page.locator('#writerFinalState').scrollIntoViewIfNeeded();
          const top = await geometry(page);
          assert.equal(top.titleOverflow, false, `${width} ${locale} ${status} title clipped`);
          assert.ok(top.documentWidth <= width + 1 && top.modal.left >= -1 && top.modal.right <= width + 1,
            `${width} ${locale} ${status} outer overflow: ${JSON.stringify(top)}`);
          const content = await page.locator('.writer-final-modal-card').evaluate(card => {
            const state = card.querySelector('#writerFinalState');
            const prepare = card.querySelector('#writerFinalPrepare');
            return { client: card.clientWidth, scroll: card.scrollWidth, stateClient: state.clientWidth,
              stateScroll: state.scrollWidth, buttonClient: prepare.clientWidth, buttonScroll: prepare.scrollWidth };
          });
          assert.ok(content.scroll <= content.client + 1 && content.stateScroll <= content.stateClient + 1 &&
            content.buttonScroll <= content.buttonClient + 1, `${width} ${locale} ${status} inner overflow: ${JSON.stringify(content)}`);
          for (const button of top.buttons) assert.ok(button.left >= -1 && button.right <= width + 1);
          if (status === 'settings_changed' || status === 'reset_ready') {
            assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
            const dialog = await confirmChoiceAction(page, false);
            assert.ok(dialog.trim().length > 0);
            await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
            await page.screenshot({ path: join(artifacts, `choice-review-${status}-${width}-${locale}.png`) });
          } else assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), false);
          assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        }
      } finally { await page.close(); }
    }
  });
});

test('interrupted choice preparation shows its cost warning and cancellable retry across desktop/mobile and five locales', { timeout: 120_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      try {
        await openChoiceReview(page, base, { locale,
          jobError: 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED' });
        await page.locator('#writerFinalState').scrollIntoViewIfNeeded();
        const state = await page.locator('#writerFinalState').textContent();
        assert.doesNotMatch(state, /STUDIO_CHOICES_|\{done\}|\{total\}/);
        assert.match(state, /31 \/ 265/);
        const wording = { ko: '자동으로 다시 생성하지', en: 'will not retry automatically', ja: '自動再生成は行いません',
          'zh-Hans': '不会自动重新生成', 'zh-Hant': '不會自動重新生成' };
        assert.ok(state.includes(wording[locale]));
        const box = await geometry(page);
        assert.ok(box.documentWidth <= width + 1 && box.modal.left >= -1 && box.modal.right <= width + 1);
        const textFits = await page.locator('#writerFinalState').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
        assert.equal(textFits, true, `${locale} ${width} warning clipped`);
        assert.equal(await page.locator('#writerFinalPrepare').isEnabled(), true);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        await confirmChoiceAction(page, false);
        await page.waitForFunction(() => !document.querySelector('#writerFinalPrepare').disabled);
        assert.equal(await page.evaluate(() => window.__finalizeQa.calls.some(call => call.method !== 'GET')), false);
        if (locale === 'ko') await page.screenshot({ path: join(artifacts, `choice-interrupted-${width}.png`) });
      } finally { await page.close(); }
    }
  });
});

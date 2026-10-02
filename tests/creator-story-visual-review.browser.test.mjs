import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.VISUAL_REVIEW_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-artifacts\\20260930-author-visual-review';
const source = await readFile(join(root, 'creator-studio/index.html'), 'utf8');
const entryStart = source.indexOf('<section id="writerFinalEntry"');
const entry = source.slice(entryStart, source.indexOf('</section>', entryStart) + 10);
const modalStart = source.indexOf('<div class="studio-modal is-hidden" id="writerFinalModal"');
const modal = source.slice(modalStart, source.indexOf('<script src="/pages/creator-studio.js', modalStart));
const promptText = '<img src=x onerror="window.__privateExecuted=true">\n' + 'ORIGINAL '.repeat(900);
const promptHash = createHash('sha256').update(promptText).digest('hex');

function bootstrap(config) {
  const qa = window.__visualReviewQa = {
    ...config, owner: 'synthetic-owner', epoch: 1, locale: 'ko', hash: 'a'.repeat(64), checksum: 'b'.repeat(64), pin: 'c'.repeat(64),
    work: '11111111-1111-4111-8111-111111111111', manuscript: '22222222-2222-4222-8222-222222222222',
    analysis: '33333333-3333-4333-8333-333333333333', batches: [], calls: [], legacy: false,
    failSaveReply: false, failRepresentativeReply: false, hold: null, pending: [], switchPin: false,
    representativeEnabled: true, selection: null, selectionVersion: 0, selectionReplies: [],
    guidanceOrigin: 'imported_reference', total: 2, wrongOrigin: null, snapshot: null,
  };
  qa.setLocale = value => { qa.locale = value; window.dispatchEvent(new Event('lumina:localechange')); };
  const active = () => ({ workId: qa.work, manuscriptVersionId: qa.manuscript, analysisJobId: qa.analysis,
    manuscriptHash: qa.hash, identity: { ownerId: qa.owner, epoch: qa.epoch } });
  window.luminaI18n = { getLocale: () => qa.locale };
  window.LuminaCreatorAnalysis = { completed: active };
  const metadata = () => ({ contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only', requiresSceneReview: true,
    guidanceOrigin: qa.guidanceOrigin, manuscriptHash: qa.hash, checksum: qa.checksum, totalReferences: qa.total, mappedReferences: qa.legacy ? 0 : qa.total,
    mappingState: qa.legacy ? 'unmapped_legacy' : 'exact_source_segments' });
  const common = () => ({ workId: qa.work, manuscriptVersionId: qa.manuscript, manuscriptHash: qa.hash });
  const original = contract => ({ contract, ...common(), checksum: qa.checksum, approvalState: 'reference_only', requiresSceneReview: true,
    guidanceOrigin: qa.guidanceOrigin, mappingState: metadata().mappingState });
  qa.showOrigin = value => {
    qa.guidanceOrigin = value;
    qa.snapshot = { ...qa.snapshot, importedVisualReferences: { ...qa.snapshot.importedVisualReferences, guidanceOrigin: value } };
    window.LuminaCreatorVisualReferences.show(qa.snapshot, active());
  };
  const row = referenceIndex => ({ referenceIndex, sourceSceneKey: 'source-' + referenceIndex, promptSha256: qa.promptHash,
    partKey: qa.legacy ? null : 'part-1', partTitle: qa.legacy ? null : '검증용 긴 장면', segmentCount: qa.legacy ? 0 : 2 });
  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const result = value => ({ ok: true, status: 200, json: async () => {
    const data = structuredClone(value);
    if (data.importedVisualReferences) qa.snapshot = data;
    return data;
  } });
  const representative = () => {
    const selection = qa.selection ? structuredClone(qa.selection) : null;
    if (selection) {
      selection.current = selection.workId === qa.work && selection.manuscriptVersionId === qa.manuscript &&
        selection.manuscriptHash === qa.hash && selection.sourceChecksum === qa.checksum && selection.profilePinHash === qa.pin && selection.analysisJobId === qa.analysis;
      if (selection.current && selection.status === 'selected') {
        const batch = qa.batches.filter(item => item.profilePinHash === qa.pin && item.entries.some(entry => entry.referenceIndex === selection.referenceIndex)).at(-1);
        selection.current = batch?.status === 'approved' && batch.batchId === selection.batchId && batch.batchChecksum === selection.batchChecksum;
      }
    }
    return { contract: 'story-part-visual-selection-context-v1', partKey: 'part-1', partTitle: '검증용 긴 장면',
      targetSceneKey: 'part-1-main', selectionVersion: qa.selectionVersion, selection };
  };
  window.LuminaCreatorStudioApi = {
    isCurrent: identity => identity?.ownerId === qa.owner && identity?.epoch === qa.epoch,
    fetch: async (url, options = {}) => {
      const path = new URL(url, location.origin), method = options.method || 'GET';
      qa.calls.push({ url, method, body: options.body, signal: options.signal });
      let data, kind = 'read';
      if (path.pathname.endsWith('/linear-draft/' + qa.manuscript)) {
        data = { manuscriptVersionId: qa.manuscript, manuscriptHash: qa.hash,
        analysisJobId: qa.analysis, parts: [{ partKey: 'part-1', title: '검증용 긴 장면', endingExcerpt: '현재 장면 끝', nextPartTitle: null }],
        scenes: [], issues: [], review: null, consent: null, releaseId: null, ready: false, importedVisualReferences: metadata() };
        qa.snapshot = data;
      }
      else if (path.pathname.endsWith('/generation-profile')) {
        const settings = { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
          sections: ['writing_style', 'scene_scale', 'canon', 'timeline', 'visual_direction', 'visual_cast', 'narrative_devices', 'branch_behavior']
            .map(key => ({ key, decision: 'accepted', value: { summary: '격리된 검증 기준' } })) };
        data = { workId: qa.work, manuscript: { id: qa.manuscript }, analysis: { id: qa.analysis },
          profile: { status: 'approved', approvedFingerprint: 'e'.repeat(64), approvedSettings: settings, draftSettings: settings } };
      } else if (path.pathname.endsWith('/visual-references')) {
        kind = 'list';
        data = { ...original('publication-visual-reference-page-v1'),
          totalReferences: qa.total, offset: 0, nextOffset: null, items: Array.from({ length: qa.total }, (_, index) => row(index)) };
      }
      else if (path.pathname.includes('/visual-references/')) {
        kind = 'detail';
        const referenceIndex = Number(path.pathname.split('/').at(-1)), offset = Number(path.searchParams.get('textOffset'));
        const prose = '검증용 소설 본문. '.repeat(1200), end = Math.min(offset + 6000, prose.length);
        data = { ...original('publication-visual-reference-detail-v1'), referenceIndex, sourceSceneKey: row(referenceIndex).sourceSceneKey,
          promptSha256: qa.promptHash, promptText: qa.prompt, reader: qa.legacy ? null : { partKey: 'part-1', partTitle: '검증용 긴 장면',
            segmentCount: 2, text: prose.slice(offset, end), textOffset: offset, nextTextOffset: end < prose.length ? end : null,
            totalTextLength: prose.length } };
      } else if (path.pathname.endsWith('/representative') && method === 'POST') {
        kind = 'representative';
        const body = options.body, referenceIndex = Number(path.pathname.split('/').at(-2));
        assertFixture(body.expectedManuscriptHash === qa.hash && body.expectedSourceChecksum === qa.checksum && body.expectedProfilePinHash === qa.pin);
        const existing = qa.selectionReplies.find(item => item.idempotencyKey === body.idempotencyKey);
        if (!existing) {
          assertFixture(body.expectedSelectionVersion === qa.selectionVersion);
          if (body.mode === 'select') {
            const batch = qa.batches.filter(item => item.entries.some(entry => entry.referenceIndex === referenceIndex)).at(-1);
            assertFixture(batch?.status === 'approved' && body.batchId === batch.batchId && body.expectedBatchChecksum === batch.batchChecksum && body.representativeReviewed === true);
          } else assertFixture(body.mode === 'clear' && !['batchId', 'expectedBatchChecksum', 'representativeReviewed'].some(key => key in body));
          qa.selectionVersion++;
          qa.selection = { contract: 'story-part-visual-selection-v1', ...common(), sourceChecksum: qa.checksum,
            analysisJobId: qa.analysis, profilePinHash: qa.pin, id: crypto.randomUUID(), partKey: 'part-1', targetSceneKey: 'part-1-main',
            selectionVersion: qa.selectionVersion, status: body.mode === 'select' ? 'selected' : 'cleared',
            referenceIndex: body.mode === 'select' ? referenceIndex : null,
            sourceSceneKey: body.mode === 'select' ? row(referenceIndex).sourceSceneKey : null,
            batchId: body.mode === 'select' ? body.batchId : null, batchChecksum: body.mode === 'select' ? body.expectedBatchChecksum : null,
            selectionChecksum: await digest(JSON.stringify(body)), createdAt: new Date().toISOString(), current: true };
          qa.selectionReplies.push({ idempotencyKey: body.idempotencyKey, selection: structuredClone(qa.selection) });
        }
        data = representative();
        if (qa.failRepresentativeReply) { qa.failRepresentativeReply = false; throw new Error('Ambiguous synthetic representative reply'); }
      } else if (path.pathname.includes('/visual-review/')) {
        kind = 'context';
        if (qa.switchPin) { qa.switchPin = false; qa.pin = 'f'.repeat(64); }
        const referenceIndex = Number(path.pathname.split('/').at(-1));
        data = { contract: 'story-visual-review-context-v1', ...common(), sourceChecksum: qa.checksum, analysisJobId: qa.analysis,
          profilePinHash: qa.pin, referenceIndex, sourceSceneKey: row(referenceIndex).sourceSceneKey, originalPromptSha256: qa.promptHash,
          batch: qa.batches.filter(batch => batch.profilePinHash === qa.pin && batch.entries.some(entry => entry.referenceIndex === referenceIndex)).at(-1) || null,
          ...(qa.representativeEnabled ? { representative: representative() } : {}) };
      } else if (path.pathname.endsWith('/visual-review-batches') && method === 'POST') {
        kind = 'save';
        const body = options.body;
        data = qa.batches.find(batch => batch.idempotencyKey === body.idempotencyKey);
        if (!data) {
          const entries = await Promise.all(body.entries.map(async item => ({ ...item, promptSha256: await digest(item.promptText),
            partKey: 'part-1', partTitle: '검증용 긴 장면', bindingSha256: 'd'.repeat(64) })));
          data = { contract: 'story-visual-review-batch-v1', ...common(), sourceChecksum: qa.checksum, analysisJobId: qa.analysis,
            profilePinHash: qa.pin, batchId: crypto.randomUUID(), batchVersion: qa.batches.length + 1,
            batchChecksum: await digest(JSON.stringify(entries)), entries, status: 'draft', revision: 1,
            approvedAt: null, generationStarted: false, published: false, idempotencyKey: body.idempotencyKey };
          qa.batches.push(data);
        }
        if (qa.failSaveReply) { qa.failSaveReply = false; throw new Error('Ambiguous synthetic reply'); }
      } else if (path.pathname.endsWith('/approve') && method === 'POST') {
        kind = 'approve';
        const batchId = path.pathname.split('/').at(-2);
        data = qa.batches.find(batch => batch.batchId === batchId);
        assertFixture(options.body.scenesReviewed === true && options.body.expectedProfilePinHash === qa.pin);
        data.status = 'approved'; data.revision = 2; data.approvedAt = new Date().toISOString();
      } else throw new Error('Unexpected controlled API route');
      const value = structuredClone(data);
      if (qa.wrongOrigin?.kind === kind) {
        if (qa.wrongOrigin.omit) delete value.guidanceOrigin;
        else value.guidanceOrigin = qa.wrongOrigin.value;
      }
      if (qa.hold === kind) return new Promise(resolve => {
        const release = () => resolve(result(value));
        release.signal = options.signal;
        qa.pending.push(release);
      });
      return result(value);
    },
  };
  function assertFixture(condition) { if (!condition) throw new Error('Invalid synthetic approval'); }
}

async function withBrowser(run) {
  await mkdir(artifacts, { recursive: true });
  const mime = { '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname;
      if (req.method !== 'GET') throw new Error('Only fixture reads');
      if (path === '/__visual-review') {
        const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/creator-studio.css"><link rel="stylesheet" href="/creator-story-visual-references.css"><link rel="stylesheet" href="/pages/creator-story-visual-review.css"></head><body class="page-creator-studio"><main>${entry}</main>${modal}<script>(${bootstrap.toString()})(${JSON.stringify({ prompt: promptText, promptHash })})</script><script src="/pages/creator-story-visual-references.js"></script><script src="/pages/creator-story-visual-review.js"></script><script src="/pages/creator-story-finalize.js"></script></body></html>`;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html); return;
      }
      const file = resolve(root, path.replace(/^\/+/, '')), local = relative(root, file);
      if (local.startsWith('..') || /^[A-Za-z]:/.test(local)) throw new Error('Outside fixture');
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await run(browser, `http://127.0.0.1:${server.address().port}`);
  } finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
}
async function pageFor(browser, base, width = 400, locale = 'ko', configure = {}, waitForReady = true) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/__visual-review');
  await page.evaluate(value => Object.assign(window.__visualReviewQa, value), configure);
  await page.evaluate(locale => window.__visualReviewQa.setLocale(locale), locale);
  await page.locator('#writerFinalOpen').click();
  await page.locator('#writerVisualReferencesOpen').click();
  if (waitForReady) await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
  return page;
}
async function saveDraft(page, text = '수정한 장면. 얼굴과 의상, 시대를 유지한다.') {
  await page.locator('#writerVisualReviewPrompt').fill(text);
  await page.locator('#writerVisualReviewSave').click();
  await page.waitForFunction(() => !document.getElementById('writerVisualReviewReviewed').disabled);
}
async function approveGuide(page) {
  await saveDraft(page);
  await page.locator('#writerVisualReviewReviewed').check();
  await page.locator('#writerVisualReviewApprove').click();
  await page.waitForFunction(() => window.__visualReviewQa.batches.at(-1)?.status === 'approved' && !document.getElementById('writerVisualReviewPrompt').disabled);
}

test('author scene guide explicitly approves, selects and clears its part representative, fits 390/400/1280 in five languages', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of [390, 400, 1280]) for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
      const page = await pageFor(browser, base, width, locale);
      try {
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), promptText);
        assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentative').isVisible(), false);
        await saveDraft(page);
        assert.equal(await page.locator('#writerVisualReviewReviewed').isChecked(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/approve')).length), 0);
        await page.locator('#writerVisualReviewReviewed').check();
        await page.locator('#writerVisualReviewApprove').click();
        await page.waitForFunction(() => window.__visualReviewQa.batches.at(-1)?.status === 'approved' && !document.getElementById('writerVisualReviewPrompt').disabled);
        assert.equal(await page.locator('#writerVisualReviewRepresentative').isVisible(), true);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')).length), 0);
        assert.match(await page.locator('#writerVisualReviewRepresentativeText').textContent(), /검증용 긴 장면/);
        await page.locator('#writerVisualReviewRepresentativeReviewed').check();
        await page.locator('#writerVisualReviewSelectRepresentative').click();
        await page.waitForFunction(() => window.__visualReviewQa.selection?.status === 'selected' && !document.getElementById('writerVisualReviewClearRepresentative').disabled);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerFinalRights').isChecked(), false);
        assert.equal(await page.locator('#writerFinalAi').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        await page.locator('#writerVisualReviewPrompt').focus();
        const bounds = await page.evaluate(() => {
          const root = document.getElementById('writerVisualReview'), card = document.querySelector('.writer-final-modal-card');
          const reviewStyle = getComputedStyle(document.getElementById('writerVisualReviewReviewText'));
          const representativeStyle = getComputedStyle(document.getElementById('writerVisualReviewRepresentativeText'));
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth,
            reviewStyle: { fontSize: reviewStyle.fontSize, lineHeight: reviewStyle.lineHeight, fontWeight: reviewStyle.fontWeight },
            representativeStyle: { fontSize: representativeStyle.fontSize, lineHeight: representativeStyle.lineHeight, fontWeight: representativeStyle.fontWeight },
            overflow: [...root.querySelectorAll('button, label, p, h4, h5, span')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.id),
            box: root.getBoundingClientRect().toJSON(), buttons: [...root.querySelectorAll('button')].map(node => node.getBoundingClientRect().toJSON()) };
        });
        assert.ok(bounds.documentWidth <= width + 1 && bounds.cardScrollWidth <= bounds.cardWidth + 1, JSON.stringify(bounds));
        assert.deepEqual(bounds.overflow, [], JSON.stringify(bounds));
        assert.equal(bounds.reviewStyle.fontSize, '14px');
        assert.equal(bounds.reviewStyle.fontWeight, '400');
        assert.ok(parseFloat(bounds.reviewStyle.lineHeight) >= 22);
        assert.equal(bounds.representativeStyle.fontSize, '14px');
        assert.equal(bounds.representativeStyle.fontWeight, '400');
        assert.ok(parseFloat(bounds.representativeStyle.lineHeight) >= 22);
        bounds.buttons.forEach(button => assert.ok(button.left >= bounds.box.left - 1 && button.right <= bounds.box.right + 1));
        assert.equal(await page.evaluate(() => window.__privateExecuted === true), false);
        assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('ORIGINAL ORIGINAL'))), false);
        await page.screenshot({ path: join(artifacts, `visual-review-${width}-${locale}.png`) });
        await page.locator('#writerVisualReviewClearRepresentative').click();
        await page.waitForFunction(() => window.__visualReviewQa.selection?.status === 'cleared' && !document.getElementById('writerVisualReviewRepresentativeReviewed').disabled);
        assert.equal(await page.locator('#writerVisualReviewClearRepresentative').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        const posts = await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')));
        assert.equal(posts.length, 2);
        assert.deepEqual(Object.keys(posts[1].body).sort(), ['expectedManuscriptHash', 'expectedProfilePinHash', 'expectedSelectionVersion', 'expectedSourceChecksum', 'idempotencyKey', 'mode']);
      } finally { await page.close(); }
    }
  });
});

test('same-reference prose paging preserves unsaved edits, editing clears approval and reopen recovers saved guidance only', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await pageFor(browser, base, 1280);
    try {
      await page.locator('#writerVisualReviewPrompt').fill('아직 저장하지 않은 수정안');
      await page.locator('#writerVisualReferencesTextNext').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesTextPrev').disabled === false);
      assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '아직 저장하지 않은 수정안');
      await saveDraft(page);
      await page.locator('#writerVisualReviewReviewed').check();
      await page.locator('#writerVisualReviewPrompt').fill('승인 전에 다시 바뀐 수정안');
      assert.equal(await page.locator('#writerVisualReviewReviewed').isChecked(), false);
      assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
      await page.locator('#writerFinalClose').click();
      assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
      await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
      assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '수정한 장면. 얼굴과 의상, 시대를 유지한다.');
    } finally { await page.close(); }
  });
});

test('lost save reply retries its idempotency key without duplicate drafts or implicit approvals', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await pageFor(browser, base);
    try {
      await page.locator('#writerVisualReviewPrompt').fill('저장 응답만 잃어버린 수정안');
      await page.evaluate(() => { window.__visualReviewQa.failSaveReply = true; });
      await page.locator('#writerVisualReviewSave').click();
      await page.waitForFunction(() => window.__visualReviewQa.batches.length === 1 && !document.getElementById('writerVisualReviewSave').disabled);
      await page.locator('#writerVisualReviewSave').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewReviewed').disabled);
      const state = await page.evaluate(() => ({ batches: window.__visualReviewQa.batches.length,
        saves: window.__visualReviewQa.calls.filter(call => call.method === 'POST' && call.url.endsWith('/visual-review-batches')),
        approvals: window.__visualReviewQa.calls.filter(call => call.url.endsWith('/approve')).length }));
      assert.equal(state.batches, 1); assert.equal(state.approvals, 0); assert.equal(state.saves.length, 2);
      assert.equal(state.saves[0].body.idempotencyKey, state.saves[1].body.idempotencyKey);
    } finally { await page.close(); }
  });
});

test('changed profile and account/late response cannot restore controls or submit an old approval', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await pageFor(browser, base);
    try {
      await saveDraft(page); await page.locator('#writerVisualReviewReviewed').check();
      await page.evaluate(() => { window.__visualReviewQa.switchPin = true; });
      await page.locator('#writerVisualReviewApprove').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReviewPrompt').value === '');
      assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/approve')).length), 0);
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => { window.__visualReviewQa.hold = 'context'; });
      await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
      await page.waitForFunction(() => window.__visualReviewQa.pending.length > 0);
      await page.evaluate(() => { const qa = window.__visualReviewQa; qa.owner = 'other-owner'; qa.epoch++; window.dispatchEvent(new Event('focus')); qa.pending.splice(0).forEach(release => release()); });
      await page.waitForFunction(() => document.getElementById('writerVisualReview').hidden);
      assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
    } finally { await page.close(); }
  });
});

test('lost representative select and clear replies retry stable keys without automatic mutations', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await pageFor(browser, base, 400, 'en');
    try {
      await approveGuide(page);
      for (const mode of ['select', 'clear']) {
        if (mode === 'select') await page.locator('#writerVisualReviewRepresentativeReviewed').check();
        await page.evaluate(() => { window.__visualReviewQa.failRepresentativeReply = true; });
        const command = page.locator(mode === 'select' ? '#writerVisualReviewSelectRepresentative' : '#writerVisualReviewClearRepresentative');
        await command.click();
        await page.waitForFunction(() => document.getElementById('writerVisualReviewRepresentativeStatus').textContent.includes('could not be confirmed') && !document.getElementById('writerVisualReviewPrompt').disabled);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        if (mode === 'select') await page.locator('#writerVisualReviewRepresentativeReviewed').check();
        await command.click();
        await page.waitForFunction(mode => window.__visualReviewQa.selection?.status === (mode === 'select' ? 'selected' : 'cleared') &&
          !document.getElementById('writerVisualReviewRepresentativeStatus').textContent.includes('could not be confirmed') && !document.getElementById('writerVisualReviewPrompt').disabled, mode);
      }
      const state = await page.evaluate(() => ({ posts: window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')),
        count: window.__visualReviewQa.selectionReplies.length, version: window.__visualReviewQa.selectionVersion }));
      assert.equal(state.posts.length, 4); assert.equal(state.count, 2); assert.equal(state.version, 2);
      assert.deepEqual(state.posts[0].body, state.posts[1].body);
      assert.deepEqual(state.posts[2].body, state.posts[3].body);
      assert.notEqual(state.posts[0].body.idempotencyKey, state.posts[2].body.idempotencyKey);
      await page.locator('#writerFinalClose').click();
      await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
      assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')).length), 4);
    } finally { await page.close(); }
  });
});

test('old manuscript/profile mapping is visibly stale; late selected receipt cannot undo a newer explicit clear', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await pageFor(browser, base, 1280, 'en');
    try {
      await approveGuide(page);
      await page.locator('#writerVisualReviewRepresentativeReviewed').check();
      await page.locator('#writerVisualReviewSelectRepresentative').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewClearRepresentative').disabled);
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => {
        const selection = window.__visualReviewQa.selection;
        selection.manuscriptVersionId = '66666666-6666-4666-8666-666666666666';
        selection.profilePinHash = '7'.repeat(64);
      });
      await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
      assert.match(await page.locator('#writerVisualReviewRepresentativeStatus').textContent(), /no longer current/);
      assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isEnabled(), true);
      await page.evaluate(() => { window.__visualReviewQa.hold = 'representative'; });
      await page.locator('#writerVisualReviewRepresentativeReviewed').check();
      await page.locator('#writerVisualReviewSelectRepresentative').click();
      await page.waitForFunction(() => window.__visualReviewQa.pending.length === 1);
      await page.locator('#writerFinalClose').click();
      await page.evaluate(() => { window.__visualReviewQa.hold = null; });
      await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReviewClearRepresentative').disabled);
      await page.locator('#writerVisualReviewClearRepresentative').click();
      await page.waitForFunction(() => window.__visualReviewQa.selection?.status === 'cleared' && !document.getElementById('writerVisualReviewRepresentativeReviewed').disabled);
      await page.evaluate(() => { window.__visualReviewQa.pending.splice(0).forEach(release => release()); });
      assert.match(await page.locator('#writerVisualReviewRepresentativeStatus').textContent(), /^No representative guide/);
      assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
      assert.equal(await page.locator('#writerFinalRights').isChecked(), false);
      assert.equal(await page.locator('#writerFinalAi').isChecked(), false);
    } finally { await page.close(); }
  });
});

test('proposal labels and explicit approval/representative flow fit 390/400/1280 across five locales', { timeout: 180_000 }, async () => {
  const expected = {
    ko: ['제안된 장면 시각 가이드', '검토할 제안 가이드', '제안된 장면 가이드 승인', '제안'],
    en: ['Proposed Scene Visual Guidance', 'Proposed guidance to review', 'Approve Proposed Scene Guidance', 'proposed'],
    ja: ['提案されたシーンのビジュアルガイド', '確認する提案ガイド', '提案されたシーンガイドを承認', '提案'],
    'zh-Hans': ['建议的场景视觉指南', '待审阅的建议指南', '批准建议的场景指南', '建议'],
    'zh-Hant': ['建議的場景視覺指南', '待審閱的建議指南', '核准建議的場景指南', '建議']
  };
  await withBrowser(async (browser, base) => {
    for (const width of [390, 400, 1280]) for (const locale of Object.keys(expected)) {
      const page = await pageFor(browser, base, width, locale, { guidanceOrigin: 'manuscript_proposal', total: 1 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        const before = await page.evaluate(() => JSON.stringify(window.__visualReviewQa.snapshot));
        for (const [index, suffix] of ['Title', 'Label', 'Approve'].entries()) {
          assert.equal(await page.locator('#writerVisualReview' + suffix).textContent(), expected[locale][index]);
        }
        assert.equal(await page.locator('#writerVisualReferencesTitle').textContent(), expected[locale][0]);
        assert.equal(await page.locator('#writerVisualReferencesSelect option').count(), 1);
        assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentative').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length), 0);
        await saveDraft(page);
        assert.equal(await page.locator('#writerVisualReviewReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/approve')).length), 0);
        await page.locator('#writerVisualReviewReviewed').check();
        await page.locator('#writerVisualReviewApprove').click();
        await page.waitForFunction(() => !document.getElementById('writerVisualReviewRepresentativeReviewed').disabled);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')).length), 0);
        for (const suffix of ['ReviewText', 'Status', 'RepresentativeTitle', 'RepresentativeText', 'RepresentativeStatus']) {
          assert.ok((await page.locator('#writerVisualReview' + suffix).textContent()).toLowerCase().includes(expected[locale][3]), `${locale}/${suffix}`);
        }
        await page.locator('#writerVisualReviewRepresentativeReviewed').check();
        await page.locator('#writerVisualReviewSelectRepresentative').click();
        await page.waitForFunction(() => !document.getElementById('writerVisualReviewClearRepresentative').disabled);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        await page.locator('#writerVisualReviewPrompt').focus();
        const bounds = await page.evaluate(() => {
          const root = document.getElementById('writerVisualReview'), card = document.querySelector('.writer-final-modal-card');
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: card.clientWidth, cardScrollWidth: card.scrollWidth,
            box: root.getBoundingClientRect().toJSON(), prompt: document.getElementById('writerVisualReviewPrompt').getBoundingClientRect().toJSON(),
            overflow: [...root.querySelectorAll('button, label, p, h4, h5, span')].filter(node => node.getClientRects().length)
              .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.id),
            buttons: [...root.querySelectorAll('button')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().toJSON()) };
        });
        assert.ok(bounds.documentWidth <= width + 1 && bounds.cardScrollWidth <= bounds.cardWidth + 1, JSON.stringify(bounds));
        assert.deepEqual(bounds.overflow, [], JSON.stringify(bounds));
        assert.ok(bounds.prompt.left >= bounds.box.left - 1 && bounds.prompt.right <= bounds.box.right + 1);
        bounds.buttons.forEach(button => assert.ok(button.left >= bounds.box.left - 1 && button.right <= bounds.box.right + 1));
        assert.equal(await page.locator('#writerFinalRights').isChecked(), false);
        assert.equal(await page.locator('#writerFinalAi').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        assert.equal(await page.evaluate(() => window.__privateExecuted === true), false);
        assert.equal(await page.evaluate(() => JSON.stringify(window.__visualReviewQa.snapshot)), before);
        await page.screenshot({ path: join(artifacts, `visual-review-proposal-${width}-${locale}.png`) });
        await page.locator('#writerVisualReviewClearRepresentative').click();
        await page.waitForFunction(() => window.__visualReviewQa.selection?.status === 'cleared' && !document.getElementById('writerVisualReviewRepresentativeReviewed').disabled);
        const posts = await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.url.endsWith('/representative')));
        assert.deepEqual(posts.map(call => call.body.mode), ['select', 'clear']);
        const writes = await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length);
        await page.locator('#writerFinalClose').click();
        await page.locator('#writerFinalOpen').click(); await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length), writes);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        await page.evaluate(() => { window.__visualReviewQa.wrongOrigin = { kind: 'detail', value: 'imported_reference' }; });
        await page.locator('#writerVisualReferencesTextNext').click();
        await page.locator('#writerVisualReferencesViewer').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
        assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length), writes);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });
});

test('wrong proposal page/detail/context origins cannot enable saving, approval or representative selection', { timeout: 120_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const kind of ['list', 'detail', 'context']) for (const wrong of [{ value: 'imported_reference' }, { value: 'unknown' }, { value: null }]) {
      const page = await pageFor(browser, base, 400, 'en', { guidanceOrigin: 'manuscript_proposal', total: 1, wrongOrigin: { kind, ...wrong } }, false);
      try {
        await page.waitForFunction(kind => kind === 'context' ? document.getElementById('writerVisualReviewStatus').textContent.includes('cannot be reviewed') :
          document.getElementById('writerVisualReferencesStatus').textContent.includes('could not be verified'), kind);
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
        for (const suffix of ['Save', 'Approve', 'SelectRepresentative', 'ClearRepresentative']) {
          assert.equal(await page.locator('#writerVisualReview' + suffix).isEnabled(), false, kind + '/' + suffix);
        }
        assert.equal(await page.locator('#writerVisualReviewReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length), 0);
      } finally { await page.close(); }
    }
  });
});

test('origin-only mode changes invalidate pending context/save/approval/representative replies without restoring state', { timeout: 120_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const origin of ['imported_reference', 'manuscript_proposal']) for (const phase of ['context', 'save', 'approve', 'representative']) {
      const page = await pageFor(browser, base, 400, 'en', { guidanceOrigin: origin, total: 1, hold: phase === 'context' ? 'context' : null }, phase !== 'context');
      try {
        if (phase === 'approve') { await saveDraft(page); await page.locator('#writerVisualReviewReviewed').check(); }
        if (phase === 'representative') { await approveGuide(page); await page.locator('#writerVisualReviewRepresentativeReviewed').check(); }
        if (phase === 'save') await page.locator('#writerVisualReviewPrompt').fill('Author guidance awaiting a save receipt');
        if (phase !== 'context') {
          await page.evaluate(phase => { window.__visualReviewQa.hold = phase; }, phase);
          await page.locator(phase === 'save' ? '#writerVisualReviewSave' : phase === 'approve' ? '#writerVisualReviewApprove' : '#writerVisualReviewSelectRepresentative').click();
        }
        await page.waitForFunction(() => window.__visualReviewQa.pending.length === 1);
        const before = await page.evaluate(() => ({ hash: window.__visualReviewQa.hash, checksum: window.__visualReviewQa.checksum }));
        const next = origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal';
        await page.evaluate(next => {
          const qa = window.__visualReviewQa; qa.hold = null; qa.showOrigin(next);
          qa.batches = []; qa.selection = null; qa.selectionVersion = 0; qa.selectionReplies = [];
        }, next);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.pending[0].signal.aborted), true);
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
        assert.equal(await page.locator('#writerVisualReviewReviewed').isChecked(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentativeReviewed').isChecked(), false);
        await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => !document.getElementById('writerVisualReviewPrompt').disabled);
        const writes = await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length);
        await page.evaluate(() => { const qa = window.__visualReviewQa; qa.pending.splice(0).forEach(release => release()); });
        await page.waitForFunction(() => document.getElementById('writerVisualReviewStatus').textContent === 'Unsaved draft');
        assert.equal(await page.locator('#writerVisualReviewTitle').textContent(), next === 'manuscript_proposal' ? 'Proposed Scene Visual Guidance' : 'Original Scene Visual Directive');
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), promptText);
        assert.equal(await page.locator('#writerVisualReviewApprove').isEnabled(), false);
        assert.equal(await page.locator('#writerVisualReviewRepresentative').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__visualReviewQa.calls.filter(call => call.method === 'POST').length), writes);
        assert.deepEqual(await page.evaluate(() => ({ hash: window.__visualReviewQa.hash, checksum: window.__visualReviewQa.checksum })), before);
        await page.evaluate(() => { window.__visualReviewQa.snapshot.importedVisualReferences.guidanceOrigin = 'unknown'; window.dispatchEvent(new Event('focus')); });
        await page.locator('#writerVisualReview').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#writerVisualReviewPrompt').inputValue(), '');
        assert.equal(await page.locator('#writerVisualReviewSelectRepresentative').isEnabled(), false);
      } finally { await page.close(); }
    }
  });
});

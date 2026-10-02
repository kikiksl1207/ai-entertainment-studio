import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.VISUAL_REFERENCES_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-visual-references-20260930';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const widths = [390, 400, 1280];
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptId = '22222222-2222-4222-8222-222222222222';
const analysisId = '33333333-3333-4333-8333-333333333333';
const promptText = '<img src=x onerror="window.__rawTextExecuted=true">\nSYNTHETIC_FULL_PROMPT_' + 'Q'.repeat(31900);
const promptSha256 = createHash('sha256').update(promptText).digest('hex');
const prose = 'x'.repeat(5999) + '\u{1F30C}' + 'z'.repeat(6020);
const partTitle = 'Synthetic part ' + 'T'.repeat(180);
const source = await readFile(join(root, 'creator-studio/index.html'), 'utf8');
const entryStart = source.indexOf('<section id="writerFinalEntry"');
const entry = source.slice(entryStart, source.indexOf('</section>', entryStart) + '</section>'.length);
const modalStart = source.indexOf('<div class="studio-modal is-hidden" id="writerFinalModal"');
const modal = source.slice(modalStart, source.indexOf('<script src="/pages/creator-studio.js', modalStart));
const bootstrap = `
  const qa = window.__visualReferenceQa = {
    workId: ${JSON.stringify(workId)}, manuscriptId: ${JSON.stringify(manuscriptId)}, analysisId: ${JSON.stringify(analysisId)},
    ownerId: 'synthetic-author', epoch: 1, hash: 'a'.repeat(64), checksum: 'b'.repeat(64), locale: 'ko', total: 17,
    legacy: false, absent: false, completed: true, calls: [], pending: [], delay: null, failure: null, corrupt: null,
    guidanceOrigin: 'imported_reference', wrongOrigin: null, snapshot: null,
    prompt: ${JSON.stringify(promptText)}, promptHash: ${JSON.stringify(promptSha256)}, prose: ${JSON.stringify(prose)},
    partTitle: ${JSON.stringify(partTitle)}
  };
  qa.setLocale = value => { qa.locale = value; window.dispatchEvent(new Event('lumina:localechange')); };
  window.luminaI18n = { getLocale: () => qa.locale };
  window.LuminaCreatorAnalysis = { completed: () => qa.completed ? { workId: qa.workId, manuscriptVersionId: qa.manuscriptId,
    analysisJobId: qa.analysisId, manuscriptHash: qa.hash, identity: { ownerId: qa.ownerId, epoch: qa.epoch } } : null };
  const metadata = () => ({ contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only',
    guidanceOrigin: qa.guidanceOrigin,
    requiresSceneReview: true, manuscriptHash: qa.hash, checksum: qa.checksum, totalReferences: qa.total,
    mappedReferences: qa.legacy ? 0 : qa.total, mappingState: qa.legacy ? 'unmapped_legacy' : 'exact_source_segments',
    items: [{ promptExcerpt: 'SYNTHETIC_PREVIEW_MUST_NOT_DISPLAY' }], truncated: qa.total > 8 });
  const common = contract => ({ contract, workId: qa.workId, manuscriptVersionId: qa.manuscriptId, manuscriptHash: qa.hash,
    guidanceOrigin: qa.guidanceOrigin,
    checksum: qa.checksum, approvalState: 'reference_only', requiresSceneReview: true,
    mappingState: qa.legacy ? 'unmapped_legacy' : 'exact_source_segments' });
  const row = index => ({ referenceIndex: index, sourceSceneKey: 'original-scene-' + index + '-' + 'k'.repeat(135),
    promptSha256: qa.promptHash, partKey: qa.legacy ? null : 'p1', partTitle: qa.legacy ? null : qa.partTitle,
    segmentCount: qa.legacy ? 0 : 2 });
  const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => {
    const value = structuredClone(data);
    if (value.importedVisualReferences) qa.snapshot = value;
    return value;
  } });
  qa.showOrigin = value => {
    qa.guidanceOrigin = value;
    qa.snapshot = { ...qa.snapshot, importedVisualReferences: { ...qa.snapshot.importedVisualReferences, guidanceOrigin: value } };
    window.LuminaCreatorVisualReferences.show(qa.snapshot, window.LuminaCreatorAnalysis.completed());
  };
  window.LuminaCreatorStudioApi = {
    isCurrent: identity => identity?.ownerId === qa.ownerId && identity?.epoch === qa.epoch,
    fetch: async (url, options = {}) => {
      const parsed = new URL(url, location.origin);
      const list = parsed.pathname.endsWith('/visual-references');
      const detail = parsed.pathname.includes('/visual-references/');
      const kind = list ? 'list' : detail ? 'detail' : 'review';
      qa.calls.push({ url, method: options.method || 'GET', identity: options.identity, signal: options.signal, kind });
      if ((options.method || 'GET') !== 'GET') throw new Error('Synthetic fixture forbids writes');
      let data;
      if (kind === 'review' && parsed.pathname.endsWith('/linear-draft/' + qa.manuscriptId)) {
        data = { manuscriptVersionId: qa.manuscriptId, manuscriptHash: qa.hash, analysisJobId: qa.analysisId,
          parts: [{ partKey: 'p1', title: qa.partTitle, endingExcerpt: 'Synthetic ending excerpt', nextPartTitle: null }],
          scenes: [], issues: [], review: null, consent: null, releaseId: null, ready: false,
          ...(qa.absent ? {} : { importedVisualReferences: metadata() }) };
        qa.snapshot = data;
      } else if (parsed.pathname.endsWith('/generation-profile')) {
        const sections = ['writing_style', 'scene_scale', 'canon', 'timeline', 'visual_direction', 'visual_cast', 'narrative_devices', 'branch_behavior'];
        const settings = { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
          sections: sections.map(key => ({ key, decision: 'accepted', value: { summary: 'Synthetic analysis' } })) };
        data = { workId: qa.workId, manuscript: { id: qa.manuscriptId }, analysis: { id: qa.analysisId },
          profile: { status: 'approved', approvedFingerprint: 'f'.repeat(64), approvedSettings: settings, draftSettings: settings } };
      } else if (list) {
        const offset = Number(parsed.searchParams.get('offset'));
        const items = Array.from({ length: Math.min(8, qa.total - offset) }, (_, index) => row(offset + index));
        data = { ...common('publication-visual-reference-page-v1'), offset, totalReferences: qa.total, items,
          nextOffset: offset + items.length < qa.total ? offset + items.length : null };
      } else if (detail) {
        const index = Number(parsed.pathname.split('/').at(-1));
        const textOffset = Number(parsed.searchParams.get('textOffset'));
        let end = Math.min(textOffset + 6000, qa.prose.length);
        if (end < qa.prose.length && /[\\uD800-\\uDBFF]/u.test(qa.prose[end - 1]) && /[\\uDC00-\\uDFFF]/u.test(qa.prose[end])) end--;
        data = { ...common('publication-visual-reference-detail-v1'), referenceIndex: index, sourceSceneKey: row(index).sourceSceneKey,
          promptSha256: qa.promptHash, promptText: qa.prompt, reader: qa.legacy ? null : {
            partKey: 'p1', partTitle: qa.partTitle, segmentCount: 2, text: qa.prose.slice(textOffset, end), textOffset,
            nextTextOffset: end < qa.prose.length ? end : null, totalTextLength: qa.prose.length } };
      } else throw new Error('Unexpected synthetic API path');
      if (qa.failure?.kind === kind) {
        const status = qa.failure.status; qa.failure = null;
        return response({ message: 'PRIVATE_DIAGNOSTIC_MUST_NOT_DISPLAY' }, status);
      }
      if (qa.corrupt && detail) {
        if (qa.corrupt === 'checksum') data.checksum = 'c'.repeat(64);
        if (qa.corrupt === 'prompt') data.promptText += 'tampered';
        if (qa.corrupt === 'reader') data.reader.partKey = 'wrong';
        if (qa.corrupt === 'offset') data.reader.nextTextOffset++;
        if (qa.corrupt === 'approval') data.approvalState = 'approved';
      }
      if (qa.wrongOrigin?.kind === kind) {
        if (qa.wrongOrigin.omit) delete data.guidanceOrigin;
        else data.guidanceOrigin = qa.wrongOrigin.value;
      }
      if (qa.delay === kind) return new Promise(resolve => qa.pending.push({ release: () => resolve(response(data)), signal: options.signal }));
      return response(data);
    }
  };
`;

function fixtureServer() {
  const mime = { '.css': 'text/css', '.js': 'text/javascript' };
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname);
      if (pathname === '/__visual-references-qa') {
        const page = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/creator-studio.css"><link rel="stylesheet" href="/creator-story-visual-references.css"></head><body class="page-creator-studio"><main>${entry}</main>${modal}<script>${bootstrap}</script><script src="/pages/creator-story-visual-references.js"></script><script src="/pages/creator-story-finalize.js"></script></body></html>`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
        return;
      }
      let path = resolve(root, pathname.replace(/^\/+/, ''));
      const local = relative(root, path);
      if (local.startsWith('..') || /^[A-Za-z]:/.test(local)) throw new Error('outside fixture');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
}

async function withBrowser(run) {
  await mkdir(artifacts, { recursive: true });
  const server = fixtureServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    await run(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}

async function newPage(browser, base, width = 400, configure = {}) {
  const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(base + '/__visual-references-qa');
  await page.evaluate(value => Object.assign(window.__visualReferenceQa, value), configure);
  await page.locator('#writerFinalOpen').click();
  await page.locator('.writer-final-profile-item').first().waitFor();
  return page;
}

async function openViewer(page) {
  await page.locator('#writerVisualReferencesOpen').click();
  await page.locator('#writerVisualReferencesColumns').waitFor({ state: 'visible' });
}

async function assertReadOnly(page) {
  assert.equal(await page.locator('#writerFinalRights').isChecked(), false);
  assert.equal(await page.locator('#writerFinalAi').isChecked(), false);
  assert.equal(await page.locator('#writerVisualReferences input').count(), 0);
  const calls = await page.evaluate(() => window.__visualReferenceQa.calls.map(call => ({ url: call.url, method: call.method })));
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(await page.evaluate(() => window.__rawTextExecuted === true), false);
  assert.equal(await page.locator('#writerVisualReferencesPrompt img').count(), 0);
  assert.equal(await page.evaluate(() => [...Object.values(sessionStorage), ...Object.values(localStorage)]
    .some(value => value.includes('SYNTHETIC_FULL_PROMPT_') || value.includes('xxxxxxxxxxxxxxxxxxxxxxxx'))), false);
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect().toJSON();
    const card = document.querySelector('.writer-final-modal-card');
    const reference = document.getElementById('writerVisualReferences');
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth, root: box('writerVisualReferences'),
      prompt: box('writerVisualReferencesPromptColumn'), reader: box('writerVisualReferencesReaderColumn'),
      select: box('writerVisualReferencesSelect'),
      overflow: [...reference.querySelectorAll('pre, button, h3, h4, p, span')].filter(node => node.getClientRects().length)
        .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.id),
      buttons: [...reference.querySelectorAll('button')].filter(node => node.getClientRects().length)
        .map(node => node.getBoundingClientRect().toJSON()) };
  });
}

test('read-only reference inspector fits 390/400/1280 across five locales with full prompt and page-only prose', { timeout: 180_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await newPage(browser, base, width);
      try {
        assert.equal(await page.locator('#writerVisualReferencesViewer').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.calls.filter(call => call.kind !== 'review').length), 0);
        await page.evaluate(value => window.__visualReferenceQa.setLocale(value), locale);
        await openViewer(page);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), prose.slice(0, 5999));
        assert.equal(await page.locator('#writerVisualReferencesSelect option').count(), 8);
        assert.equal(await page.locator('#writerVisualReferencesSelect option').first().textContent(), '1. ' + partTitle);
        assert.doesNotMatch(await page.locator('#writerVisualReferencesTextRange').textContent(), /UTF-16|5999|12021/);
        assert.equal(await page.locator('#writerVisualReferencesPageNote').isVisible(), true);
        assert.ok((await page.locator('#writerVisualReferencesNotice').textContent()).length > 0);
        assert.ok(!(await page.locator('body').innerText()).includes('SYNTHETIC_PREVIEW_MUST_NOT_DISPLAY'));
        await page.locator('#writerVisualReferencesSelect').focus();
        const bounds = await geometry(page);
        assert.ok(bounds.documentWidth <= width + 1, JSON.stringify(bounds));
        assert.ok(bounds.cardScrollWidth <= bounds.cardWidth + 1, JSON.stringify(bounds));
        assert.deepEqual(bounds.overflow, [], JSON.stringify(bounds));
        assert.ok(bounds.select.left >= bounds.root.left - 1 && bounds.select.right <= bounds.root.right + 1, JSON.stringify(bounds));
        if (width < 500) assert.ok(bounds.reader.top >= bounds.prompt.bottom, JSON.stringify(bounds));
        else assert.ok(bounds.reader.left >= bounds.prompt.right, JSON.stringify(bounds));
        for (const button of bounds.buttons) assert.ok(button.left >= bounds.root.left - 1 && button.right <= bounds.root.right + 1, JSON.stringify(bounds));
        await assertReadOnly(page);
        await page.screenshot({ path: join(artifacts, `visual-references-${width}-${locale}.png`) });
      } finally { await page.close(); }
    }
  });
});

test('list and prose navigation follow explicit offsets, preserve full prompts and use a keyboard-accessible selector', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await newPage(browser, base, 1280);
    try {
      await openViewer(page);
      await page.locator('#writerVisualReferencesTextNext').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesReader').textContent.startsWith('\u{1F30C}'));
      assert.equal((await page.locator('#writerVisualReferencesReader').textContent()).length, 6000);
      await page.locator('#writerVisualReferencesTextNext').click();
      await page.waitForFunction(() => !document.getElementById('writerVisualReferencesTextPrev').disabled && document.getElementById('writerVisualReferencesTextNext').disabled);
      assert.equal((await page.locator('#writerVisualReferencesReader').textContent()).length, 22);
      assert.match(await page.locator('#writerVisualReferencesTextRange').textContent(), /3.*마지막/);
      await page.locator('#writerVisualReferencesTextPrev').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesReader').textContent.startsWith('\u{1F30C}'));
      await page.locator('#writerVisualReferencesTextPrev').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesTextPrev').disabled);
      const offsets = await page.evaluate(() => window.__visualReferenceQa.calls.filter(call => call.kind === 'detail').map(call => new URL(call.url, location.origin).searchParams.get('textOffset')));
      assert.deepEqual(offsets, ['0', '5999', '11999', '5999', '0']);
      assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
      for (const value of ['8', '16']) {
        await page.locator('#writerVisualReferencesListNext').click();
        await page.waitForFunction(value => document.getElementById('writerVisualReferencesSelect').value === value && !document.getElementById('writerVisualReferencesColumns').hidden, value);
      }
      assert.equal(await page.locator('#writerVisualReferencesSelect option').count(), 1);
      assert.equal(await page.locator('#writerVisualReferencesListNext').isDisabled(), true);
      await page.locator('#writerVisualReferencesListPrev').click();
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesSelect').value === '8' && !document.getElementById('writerVisualReferencesSelect').disabled);
      await page.locator('#writerVisualReferencesSelect').selectOption('11');
      await page.waitForFunction(() => document.getElementById('writerVisualReferencesSceneKey').textContent.startsWith('original-scene-11-'));
      await page.locator('#writerVisualReferencesSelect').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'writerVisualReferencesListPrev');
      await page.locator('#writerVisualReferencesPrompt').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'writerVisualReferencesReader');
      await page.locator('#writerFinalClose').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.getElementById('writerFinalModal').contains(document.activeElement)), true);
      await assertReadOnly(page);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#writerFinalModal').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'writerFinalOpen');
      assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
    } finally { await page.close(); }
  });
});

test('absent and empty metadata are lazy; legacy references have no guessed reader text in all locales', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const configure of [{ absent: true }, { total: 0 }]) {
      const page = await newPage(browser, base, 390, configure);
      try {
        assert.equal(await page.locator('#writerVisualReferencesOpen').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.calls.filter(call => call.kind !== 'review').length), 0);
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
    const page = await newPage(browser, base, 400, { legacy: true });
    try {
      await openViewer(page);
      for (const locale of locales) {
        await page.evaluate(value => window.__visualReferenceQa.setLocale(value), locale);
        assert.equal(await page.locator('#writerVisualReferencesUnmapped').isVisible(), true);
        assert.equal(await page.locator('#writerVisualReferencesReader').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesTextPager').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
      }
      await assertReadOnly(page);
    } finally { await page.close(); }
  });
});

test('mapped omitted-title-only ranges show localized no-prose warnings and remain unapproved', { timeout: 60_000 }, async () => {
  await withBrowser(async (browser, base) => {
    const page = await newPage(browser, base, 390, { prose: '' });
    try {
      await openViewer(page);
      const warnings = new Set();
      for (const locale of locales) {
        await page.evaluate(value => window.__visualReferenceQa.setLocale(value), locale);
        assert.equal(await page.locator('#writerVisualReferencesNoProse').isVisible(), true);
        warnings.add(await page.locator('#writerVisualReferencesNoProse').textContent());
        assert.equal(await page.locator('#writerVisualReferencesReader').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesUnmapped').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesTextPager').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
      }
      assert.equal(warnings.size, 5);
      await assertReadOnly(page);
    } finally { await page.close(); }
  });
});

test('network failures have bounded retries; 404/409 and malformed details expose no old/private text', { timeout: 120_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const kind of ['list', 'detail']) {
      const page = await newPage(browser, base, 400, { failure: { kind, status: 503 } });
      try {
        await page.locator('#writerVisualReferencesOpen').click();
        await page.locator('#writerVisualReferencesRetry').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_DIAGNOSTIC_MUST_NOT_DISPLAY'));
        await page.locator('#writerVisualReferencesRetry').click();
        await page.locator('#writerVisualReferencesColumns').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
    for (const status of [404, 409]) {
      const page = await newPage(browser, base, 390);
      try {
        await openViewer(page);
        await page.evaluate(status => { window.__visualReferenceQa.failure = { kind: 'detail', status }; }, status);
        await page.locator('#writerVisualReferencesTextNext').click();
        await page.locator('#writerVisualReferencesViewer').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesRetry').isVisible(), false);
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
    for (const corrupt of ['checksum', 'prompt', 'reader', 'offset', 'approval']) {
      const page = await newPage(browser, base, 400, { corrupt });
      try {
        await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => document.getElementById('writerVisualReferencesStatus').textContent.includes('검증'));
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesViewer').isVisible(), false);
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
  });
});

test('close/reopen aborts pending list and detail responses without displaying the prior session', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const delay of ['list', 'detail']) {
      const page = await newPage(browser, base, 400, { delay });
      try {
        await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => window.__visualReferenceQa.pending.length === 1);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        await page.locator('#writerFinalClose').click();
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.pending[0].signal.aborted), true);
        await page.evaluate(() => { window.__visualReferenceQa.delay = null; });
        await page.locator('#writerFinalOpen').click();
        await page.locator('#writerVisualReferencesOpen').waitFor({ state: 'visible' });
        await page.evaluate(() => window.__visualReferenceQa.pending.shift().release());
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesViewer').isVisible(), false);
        await openViewer(page);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
  });
});

test('account/token/work/manuscript/analysis/hash/source invalidation clears text and rejects pending responses', { timeout: 120_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const changed of ['ownerId', 'epoch', 'workId', 'manuscriptId', 'analysisId', 'hash', 'source']) {
      const page = await newPage(browser, base, 400);
      try {
        await openViewer(page);
        await page.evaluate(() => { window.__visualReferenceQa.delay = 'detail'; });
        await page.locator('#writerVisualReferencesTextNext').click();
        await page.waitForFunction(() => window.__visualReferenceQa.pending.length === 1);
        await page.evaluate(changed => {
          const qa = window.__visualReferenceQa;
          if (changed === 'epoch') qa.epoch++;
          else if (changed === 'source') {
            qa.checksum = 'c'.repeat(64);
            window.LuminaCreatorVisualReferences.show({ manuscriptVersionId: qa.manuscriptId, analysisJobId: qa.analysisId,
              manuscriptHash: qa.hash, parts: [{ partKey: 'p1', title: qa.partTitle }], importedVisualReferences: {
                contract: 'publication-visual-reference-preview-v1', manuscriptHash: qa.hash, checksum: qa.checksum,
                approvalState: 'reference_only', requiresSceneReview: true, totalReferences: qa.total, mappedReferences: qa.total,
                mappingState: 'exact_source_segments' } }, window.LuminaCreatorAnalysis.completed());
          } else qa[changed] = changed === 'ownerId' ? 'other-account' : changed === 'hash' ? 'c'.repeat(64) : '44444444-4444-4444-8444-444444444444';
          qa.pending[0].release();
        }, changed);
        if (changed !== 'source') await page.locator('#writerVisualReferences').waitFor({ state: 'hidden' });
        else await page.locator('#writerVisualReferencesOpen').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.pending[0].signal.aborted), true);
        assert.ok((await page.evaluate(() => window.__visualReferenceQa.calls)).every(call => call.method === 'GET'));
      } finally { await page.close(); }
    }
  });
});

test('proposal reference labels fit 390/400/1280 in all five locales and wrong detail origin fails closed', { timeout: 180_000 }, async () => {
  const expected = {
    ko: ['제안된 장면 시각 가이드', '제안된 장면 가이드', '제안 가이드 전체'],
    en: ['Proposed Scene Visual Guidance', 'Proposed scene guidance', 'Full proposed guidance'],
    ja: ['提案されたシーンのビジュアルガイド', '提案されたシーンガイド', '提案ガイド全文'],
    'zh-Hans': ['建议的场景视觉指南', '建议的场景指南', '建议指南全文'],
    'zh-Hant': ['建議的場景視覺指南', '建議的場景指南', '建議指南全文']
  };
  await withBrowser(async (browser, base) => {
    for (const width of widths) for (const locale of locales) {
      const page = await newPage(browser, base, width, { guidanceOrigin: 'manuscript_proposal', total: 1 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        const before = await page.evaluate(() => JSON.stringify(window.__visualReferenceQa.snapshot));
        await page.evaluate(value => window.__visualReferenceQa.setLocale(value), locale);
        await openViewer(page);
        for (const [index, suffix] of ['Title', 'Label', 'PromptTitle'].entries()) {
          assert.equal(await page.locator('#writerVisualReferences' + suffix).textContent(), expected[locale][index]);
        }
        assert.equal(await page.locator('#writerVisualReferencesSelect option').count(), 1);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), prose.slice(0, 5999));
        assert.equal(await page.locator('#writerVisualReferencesPageNote').isVisible(), true);
        const count = await page.evaluate(() => window.__visualReferenceQa.calls.length);
        await page.evaluate(value => window.__visualReferenceQa.setLocale(value), locale);
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.calls.length), count);
        assert.equal(await page.evaluate(() => JSON.stringify(window.__visualReferenceQa.snapshot)), before);
        await page.locator('#writerVisualReferencesPrompt').focus();
        const bounds = await geometry(page);
        assert.ok(bounds.documentWidth <= width + 1 && bounds.cardScrollWidth <= bounds.cardWidth + 1, JSON.stringify(bounds));
        assert.deepEqual(bounds.overflow, [], JSON.stringify(bounds));
        assert.ok(bounds.select.left >= bounds.root.left - 1 && bounds.select.right <= bounds.root.right + 1);
        if (width < 500) assert.ok(bounds.reader.top >= bounds.prompt.bottom);
        else assert.ok(bounds.reader.left >= bounds.prompt.right);
        bounds.buttons.forEach(button => assert.ok(button.left >= bounds.root.left - 1 && button.right <= bounds.root.right + 1));
        await assertReadOnly(page);
        await page.screenshot({ path: join(artifacts, `visual-references-proposal-${width}-${locale}.png`) });
        await page.evaluate(() => { window.__visualReferenceQa.wrongOrigin = { kind: 'detail', value: 'imported_reference' }; });
        await page.locator('#writerVisualReferencesTextNext').click();
        await page.locator('#writerVisualReferencesViewer').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesRetry').isVisible(), false);
        assert.equal(await page.evaluate(() => JSON.stringify(window.__visualReferenceQa.snapshot)), before);
        await assertReadOnly(page);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  });
});

test('wrong, unknown and missing proposal page/detail origins cannot display guidance', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const kind of ['list', 'detail']) for (const wrong of [{ value: 'imported_reference' }, { value: 'unknown' }, { value: null }, { omit: true }]) {
      const page = await newPage(browser, base, 400, { guidanceOrigin: 'manuscript_proposal', total: 1, wrongOrigin: { kind, ...wrong } });
      try {
        await page.evaluate(() => window.__visualReferenceQa.setLocale('en'));
        await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => document.getElementById('writerVisualReferencesStatus').textContent === 'Proposed guidance identity or bounds could not be verified.');
        assert.equal(await page.locator('#writerVisualReferencesViewer').isVisible(), false);
        assert.equal(await page.locator('#writerVisualReferencesSelect option').count(), 0);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
  });
});

test('origin-only mode changes abort late list/detail responses and invalid preview origin hides the inspector', { timeout: 90_000 }, async () => {
  await withBrowser(async (browser, base) => {
    for (const origin of ['imported_reference', 'manuscript_proposal']) for (const delay of ['list', 'detail']) {
      const page = await newPage(browser, base, 400, { guidanceOrigin: origin, total: 1, delay });
      try {
        await page.evaluate(() => window.__visualReferenceQa.setLocale('en'));
        const before = await page.evaluate(() => ({ hash: window.__visualReferenceQa.hash, checksum: window.__visualReferenceQa.checksum }));
        await page.locator('#writerVisualReferencesOpen').click();
        await page.waitForFunction(() => window.__visualReferenceQa.pending.length === 1);
        const next = origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal';
        await page.evaluate(next => { const qa = window.__visualReferenceQa; qa.delay = null; qa.showOrigin(next); }, next);
        assert.equal(await page.evaluate(() => window.__visualReferenceQa.pending[0].signal.aborted), true);
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        await openViewer(page);
        await page.evaluate(() => window.__visualReferenceQa.pending.shift().release());
        await page.waitForFunction(() => !document.getElementById('writerVisualReferencesSelect').disabled);
        assert.equal(await page.locator('#writerVisualReferencesTitle').textContent(), next === 'manuscript_proposal' ? 'Proposed Scene Visual Guidance' : 'Original Scene Visual References');
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), promptText);
        assert.deepEqual(await page.evaluate(() => ({ hash: window.__visualReferenceQa.hash, checksum: window.__visualReferenceQa.checksum })), before);
        await page.evaluate(() => { window.__visualReferenceQa.snapshot.importedVisualReferences.guidanceOrigin = 'unknown'; window.dispatchEvent(new Event('focus')); });
        await page.locator('#writerVisualReferences').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#writerVisualReferencesPrompt').textContent(), '');
        assert.equal(await page.locator('#writerVisualReferencesReader').textContent(), '');
        await assertReadOnly(page);
      } finally { await page.close(); }
    }
  });
});

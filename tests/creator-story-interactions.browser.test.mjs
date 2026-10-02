import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const enabled = process.env.CREATOR_INTERACTIONS_BROWSER_QA === '1';
const smoke = process.env.CREATOR_INTERACTIONS_BROWSER_SMOKE === '1';
const artifacts = 'E:/Codex/LuminaStage/qa-artifacts/20261001-creator-interactions';
const temp = 'E:/Codex/LuminaStage/qa-tmp/20261001-creator-interactions';
const bundle = 'C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const origin = 'https://creator-interactions-fixture.invalid';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pin = { ownerUserId: id(1), workId: id(2), releaseId: id(3), releaseChecksum: 'a'.repeat(64),
  manuscriptVersionId: id(4), manuscriptHash: 'b'.repeat(64), artistId: id(5), beatId: id(6), sceneId: id(7), partId: id(8),
  identityProfileId: id(9), locale: 'ko', sourceChecksum: 'c'.repeat(64), identityPinHash: 'd'.repeat(64) };
const sourceTexts = { ko: '아스터는 함께 문을 열었다. "나와 함께 가요."', en: 'Aster opened the door together. "Come with me."',
  ja: 'アスターは一緒に扉を開いた。「一緒に行こう。」', 'zh-Hans': '阿斯特一起打开了门。“跟我一起走吧。”', 'zh-Hant': '阿斯特一起打開了門。「跟我一起走吧。」' };
function bootstrap(config) {
  const qa = window.__interactionQa = { ...config, locale: 'ko', epoch: 1, ownerId: config.pin.ownerUserId,
    calls: [], responses: [], approved: [], mode: config.mode ?? null, hold: false, releaseHeld: null, forbidden: [] };
  const identity = () => ({ ownerId: qa.ownerId, epoch: qa.epoch });
  const isCurrent = value => Boolean(value?.ownerId && value.ownerId === qa.ownerId && value.epoch === qa.epoch);
  window.luminaI18n = { getLocale: () => qa.locale };
  window.fetch = () => { qa.forbidden.push('Unexpected native network'); throw new Error('Network forbidden'); };
  window.LuminaCreatorStudioApi = { identity, isCurrent, fetch: async (url, options = {}) => {
    const address = new URL(url, location.href), method = options.method || 'GET';
    const call = { url, method, body: structuredClone(options.body ?? null), identity: structuredClone(options.identity ?? null),
      retried: options._retried === true }; qa.calls.push(call);
    if (address.origin !== location.origin || !options.identity || !isCurrent(options.identity)) {
      qa.forbidden.push(`Invalid context: ${method} ${address.pathname}`); throw new Error('Context');
    }
    const respond = (data, status = 200) => {
      qa.responses.push({ url, method, status });
      return { ok: status === 200, status, json: async () => structuredClone(data) };
    };
    if (qa.hold && method === 'GET' && address.pathname.endsWith(`/interactions/beats/${qa.pin.beatId}`)) {
      await new Promise(resolve => { qa.releaseHeld = resolve; }); qa.releaseHeld = null;
    }
    const locale = address.searchParams.get('locale') || options.body?.locale || 'ko';
    const pin = { ...qa.pin, locale }, text = qa.sourceTexts[locale]; let data;
    if (address.pathname === '/api/v1/me/creator-studio/stories' && method === 'GET') data = { items: [
      { workId: pin.workId, title: { value: 'Synthetic canonical source for review' }, publication: { published: true, status: 'published', activeReleaseId: pin.releaseId } },
    ], nextCursor: null };
    else if (address.pathname.endsWith('/artist-candidates') && method === 'GET') data = { engaged: [], searchResults: [
      { artistId: pin.artistId, displayName: 'Aster', visualIdentityReady: true },
      { artistId: qa.unreadyId, displayName: 'Unready artist', visualIdentityReady: false },
    ] };
    else if (address.pathname.endsWith('/interactions/beats') && method === 'GET') data = { contract: 'story-canonical-interaction-catalog-v1', ...pin,
      items: [{ beatId: pin.beatId, sceneId: pin.sceneId, partId: pin.partId, partPosition: 1, scenePosition: 1, beatPosition: 1,
        beatType: 'narration', sourceText: qa.mode === 'missing' ? null : text, sourceAvailable: qa.mode !== 'missing' }], nextAfterBeatId: null };
    else if (address.pathname.endsWith(`/interactions/beats/${pin.beatId}`) && method === 'GET') data = {
      contract: 'story-canonical-interaction-review-v1', identity: pin, sourceText: text, artistDisplayName: 'Aster',
      approvals: qa.approved.filter(row => row.locale === locale), moreApprovals: false, proposalApproved: false, readerMemoryApplied: false,
    };
    else if (address.pathname.endsWith('/approve') && method === 'POST') {
      if (qa.mode === 'failure') return respond({ privateDiagnostic: 'DO_NOT_RENDER' }, 409);
      const body = options.body;
      if (!body.interactionReviewed || body.expectedSourceChecksum !== pin.sourceChecksum || body.expectedIdentityPinHash !== pin.identityPinHash) throw new Error('Approval binding');
      data = { contract: 'story-canonical-interaction-approval-v1', ...pin, approvalId: qa.approvalId,
        approvalChecksum: 'e'.repeat(64), interactionKind: body.interactionKind, evidenceStart: body.evidenceStart,
        evidenceText: body.evidenceText, memoryText: body.memoryText, status: 'approved', revision: 1,
        approvedAt: '2026-10-01T00:00:00Z', revokedAt: null, readerMemoryApplied: false };
      qa.approved = [data];
    } else if (address.pathname.endsWith('/revoke') && method === 'POST') {
      data = { ...qa.approved[0], status: 'revoked', revision: 2, revokedAt: '2026-10-01T01:00:00Z' }; qa.approved = [data];
    } else { qa.forbidden.push(`${method} ${address.pathname}`); throw new Error('Unexpected API'); }
    if (qa.mode === 'foreign' && data.contract === 'story-canonical-interaction-catalog-v1') data.ownerUserId = qa.unreadyId;
    return respond(data);
  } };
}

async function fixturePage(context, source, css, width, mode = null) {
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(bootstrap, { pin, sourceTexts, unreadyId: id(20), approvalId: id(25), mode });
  await page.route('**/*', route => {
    const address = new URL(route.request().url());
    if (address.origin === origin && address.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font-family:system-ui;color:#18181b}button{font:inherit}${css}</style></head><body><main id="studioShell"><section id="writer-manuscript" class="is-active"><section id="writerInteractions"></section></section></main><script>${source}</script></body></html>` });
    return route.abort();
  });
  return { page, errors };
}

async function domSnapshot(page) {
  return page.evaluate(() => [document.documentElement.outerHTML, document.body.textContent,
    ...[...document.querySelectorAll('input, textarea, select')].map(node => node.value)].join('\n'));
}

async function assertPrivateSourceCleared(page) {
  assert.equal(await page.locator('[data-interaction-source], [data-interaction-evidence-source], [data-interaction-evidence], [data-interaction-memory]').count(), 0);
  const dom = await domSnapshot(page);
  for (const source of Object.values(sourceTexts)) assert.equal(dom.includes(source), false, 'Private source or locale fallback leaked into DOM');
}

async function assertNoSuccessRecords(page) {
  assert.equal(await page.locator('.writer-interaction-records li, [data-interaction-revoke]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__interactionQa.approved), []);
}

async function assertRequestCounts(page, reviews, approvals) {
  const calls = await page.evaluate(() => window.__interactionQa.calls);
  assert.equal(calls.filter(row => row.method === 'GET' && new URL(row.url, origin).pathname.endsWith(`/interactions/beats/${pin.beatId}`)).length, reviews);
  assert.equal(calls.filter(row => row.method === 'POST' && new URL(row.url, origin).pathname.endsWith('/approve')).length, approvals);
  assert.equal(calls.filter(row => row.method === 'POST').length, approvals, 'No extra approval or revoke POST');
  return calls;
}

test('author canonical event browser workflow and responsive source review', { skip: !enabled, timeout: 150000 }, async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'E:/Codex/LuminaStage/qa-browsers';
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp;
  await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true });
  const source = await readFile(new URL('../pages/creator-story-interactions.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../pages/creator-story-interactions.css', import.meta.url), 'utf8');
  const { chromium } = createRequire(import.meta.url)(bundle);
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), { headless: true,
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  const evidence = [], failures = [], pages = [];
  const errorScenarios = [
    { name: 'missing-source-locale', mode: 'missing', locale: 'ja' },
    { name: 'foreign-catalog-owner', mode: 'foreign', locale: 'en' },
    { name: 'approval-409-private-diagnostic', mode: 'failure', locale: 'en' },
    { name: 'delayed-review-after-logout', mode: null, locale: 'en' },
  ];
  try {
    for (const width of (smoke ? [390] : [390, 400, 1280])) for (const locale of (smoke ? ['ko'] : ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])) {
      const { page, errors } = await fixturePage(context, source, css, width); pages.push(page);
      try {
        await page.goto(origin);
        await page.evaluate(locale => { window.__interactionQa.locale = locale; document.documentElement.lang = locale; window.dispatchEvent(new Event('lumina:localechange')); }, locale);
        await page.locator('[data-interaction-action="works"]').click();
        await page.locator('[data-interaction-work]').selectOption(pin.workId);
        await page.locator('[data-interaction-locale]').selectOption(locale);
        await page.locator('[data-interaction-action="source"]').click();
        await page.locator('[data-interaction-beat]').selectOption(pin.beatId);
        await page.locator('[data-interaction-search]').fill('Aster');
        await page.locator('[data-interaction-action="search"]').click();
        const unready = await page.locator(`[data-interaction-artist] option[value="${id(20)}"]`).evaluate(node => ({ disabled: node.disabled, html: node.outerHTML }));
        assert.equal(unready.disabled, true, unready.html);
        await page.locator('[data-interaction-artist]').selectOption(pin.artistId);
        await page.locator('[data-interaction-action="review"]').click();
        const sourceBox = page.locator('[data-interaction-evidence-source]');
        await sourceBox.waitFor(); assert.equal(await sourceBox.inputValue(), sourceTexts[locale]);
        await sourceBox.evaluate(node => node.setSelectionRange(0, node.value.indexOf('.') >= 0 ? node.value.indexOf('.') + 1 : 10));
        await page.locator('[data-interaction-action="extract"]').click();
        await page.locator('[data-interaction-memory]').pressSequentially('Opened the door together.', { delay: 1 });
        assert.equal(await page.locator('[data-interaction-memory]').inputValue(), 'Opened the door together.');
        await page.locator('[data-interaction-ack]').check();
        const screenshot = join(artifacts, `review-${width}-${locale}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const fit = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, width: innerWidth,
          controls: [...document.querySelectorAll('#writerInteractions button, #writerInteractions select, #writerInteractions textarea')].map(node => ({
            left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width,
          })) }));
        assert.ok(fit.documentWidth <= width + 1); for (const rect of fit.controls) assert.ok(rect.left >= -1 && rect.right <= width + 1 && rect.width > 0);
        await page.locator('[data-interaction-action="approve"]').click();
        await page.locator('[data-interaction-revoke]').waitFor();
        await page.locator('[data-interaction-revoke]').click();
        assert.equal(await page.locator('dialog').isVisible(), true);
        await page.locator('[data-interaction-action="confirm"]').click();
        await page.waitForFunction(() => window.__interactionQa.approved[0]?.status === 'revoked');
        assert.equal(await page.locator('[data-interaction-revoke]').count(), 0);
        const commands = await page.evaluate(() => window.__interactionQa.calls.filter(row => row.method === 'POST'));
        assert.equal(commands.length, 2); assert.equal(commands[0].body.locale, locale); assert.equal(commands[0].body.interactionReviewed, true);
        assert.deepEqual(await page.evaluate(() => window.__interactionQa.forbidden), []); assert.deepEqual(errors, []);
        evidence.push({ width, locale, passed: true, screenshot, commands: 2, sourceMatches: true, controlsFit: true });
        if (width === 390 && locale === 'ko') {
          await page.evaluate(() => { window.__interactionQa.epoch++; window.__interactionQa.ownerId = null; window.dispatchEvent(new Event('storage')); });
          assert.equal(await page.locator('[data-interaction-source]').count(), 0);
          assert.equal(await page.locator('[data-interaction-evidence-source]').count(), 0);
          assert.equal(await page.locator('[data-interaction-work] option').count(), 1);
          evidence.push({ scenario: 'logout-clears-private-source', passed: true });
        }
      } catch (error) {
        const screenshot = join(artifacts, `failed-${width}-${locale}.png`); await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        failures.push({ width, locale, error: error.message, stack: error.stack, screenshot, errors });
      } finally { await page.close(); }
    }
    for (const scenario of errorScenarios) {
      const { page, errors } = await fixturePage(context, source, css, 390, scenario.mode); pages.push(page);
      page.setDefaultTimeout(10000);
      try {
        await page.goto(origin);
        await page.evaluate(() => { window.__interactionQa.locale = 'en'; document.documentElement.lang = 'en'; window.dispatchEvent(new Event('lumina:localechange')); });
        await page.locator('[data-interaction-action="works"]').click();
        await page.locator('[data-interaction-work]').selectOption(pin.workId);
        await page.locator('[data-interaction-locale]').selectOption(scenario.locale);
        await page.locator('[data-interaction-action="source"]').click();
        let details;
        if (scenario.mode === 'foreign') {
          await page.waitForFunction(() => document.querySelector('.writer-interaction-state')?.textContent === 'The result could not be confirmed. Check again.');
          assert.equal(await page.locator('[data-interaction-beat]').count(), 0);
          assert.equal(await page.locator('[data-interaction-action="review"]').isDisabled(), true);
          await assertPrivateSourceCleared(page); await assertNoSuccessRecords(page);
          const calls = await assertRequestCounts(page, 0, 0); assert.equal(calls.length, 2);
          details = { failed: true, sourceVisible: false, reviewRequests: 0, approvalPosts: 0 };
        } else {
          const option = page.locator(`[data-interaction-beat] option[value="${pin.beatId}"]`);
          await option.waitFor({ state: 'attached' });
          if (scenario.mode !== 'missing') await page.locator('[data-interaction-beat]').selectOption(pin.beatId);
          await page.locator('[data-interaction-search]').fill('Aster');
          await page.locator('[data-interaction-action="search"]').click();
          await page.locator('[data-interaction-artist]').selectOption(pin.artistId);
          if (scenario.mode === 'missing') {
            assert.equal(await option.evaluate(node => node.disabled), true);
            assert.equal(await page.locator('[data-interaction-action="review"]').isDisabled(), true);
            assert.equal(await page.locator('[data-interaction-action="approve"]').count(), 0);
            await assertPrivateSourceCleared(page); await assertNoSuccessRecords(page);
            const calls = await assertRequestCounts(page, 0, 0); assert.equal(calls.length, 3);
            const catalogCall = calls.find(row => new URL(row.url, origin).pathname.endsWith('/interactions/beats'));
            assert.equal(new URL(catalogCall.url, origin).searchParams.get('locale'), 'ja');
            details = { sourceLocale: 'ja', sourceOptionDisabled: true, reviewRequests: 0, approvalPosts: 0 };
          } else if (scenario.mode === 'failure') {
            await page.locator('[data-interaction-action="review"]').click();
            const sourceBox = page.locator('[data-interaction-evidence-source]');
            await sourceBox.waitFor(); assert.equal(await sourceBox.inputValue(), sourceTexts.en);
            await sourceBox.evaluate(node => node.setSelectionRange(0, node.value.indexOf('.') + 1));
            await page.locator('[data-interaction-action="extract"]').click();
            await page.locator('[data-interaction-memory]').fill('Opened the door together.');
            await page.locator('[data-interaction-ack]').check();
            await page.locator('[data-interaction-action="approve"]').click();
            await page.waitForFunction(() => document.querySelector('.writer-interaction-state')?.textContent === 'The result could not be confirmed. Check again.');
            // Observe a settled failure and a bounded window for unsolicited POST retries.
            await page.waitForTimeout(1000);
            const calls = await assertRequestCounts(page, 1, 1);
            assert.equal(calls.filter(row => row.method === 'POST')[0].retried, true, 'Approval opts out of automatic API retry');
            assert.equal(await page.evaluate(() => window.__interactionQa.responses.filter(row => row.method === 'POST' && row.status === 409).length), 1);
            const dom = await domSnapshot(page);
            for (const diagnostic of ['privateDiagnostic', 'DO_NOT_RENDER']) assert.equal(dom.includes(diagnostic), false);
            await assertNoSuccessRecords(page);
            details = { responseStatus: 409, privateDiagnosticVisible: false, successRecords: 0, approvalPosts: 1, automaticPostRetries: 0, quietWindowMs: 1000 };
          } else {
            assert.equal(await page.locator('[data-interaction-source]').inputValue(), sourceTexts.en);
            await page.evaluate(() => { window.__interactionQa.hold = true; });
            await page.locator('[data-interaction-action="review"]').click();
            await page.waitForFunction(() => typeof window.__interactionQa.releaseHeld === 'function');
            const callsBeforeLogout = await assertRequestCounts(page, 1, 0);
            assert.equal(await page.evaluate(() => window.__interactionQa.responses.some(row => new URL(row.url, location.href).pathname.endsWith(`/interactions/beats/${window.__interactionQa.pin.beatId}`))), false);
            await page.evaluate(() => { window.__interactionQa.epoch++; window.__interactionQa.ownerId = null; window.dispatchEvent(new Event('storage')); });
            await assertPrivateSourceCleared(page); await assertNoSuccessRecords(page);
            assert.equal(await page.locator('[data-interaction-work] option').count(), 1);
            await page.evaluate(() => { const qa = window.__interactionQa; qa.hold = false; qa.releaseHeld(); });
            await page.waitForFunction(() => window.__interactionQa.responses.some(row => row.method === 'GET' && row.status === 200 && new URL(row.url, location.href).pathname.endsWith(`/interactions/beats/${window.__interactionQa.pin.beatId}`)));
            // The late response must settle before checking that private UI stays cleared.
            await page.waitForTimeout(1000);
            await assertPrivateSourceCleared(page); await assertNoSuccessRecords(page);
            assert.equal(await page.locator('[data-interaction-work] option').count(), 1);
            assert.equal(await page.locator('[data-interaction-action="approve"]').count(), 0);
            assert.deepEqual(await assertRequestCounts(page, 1, 0), callsBeforeLogout, 'No continued request after logout or late response');
            details = { heldReviewReleased: true, sourceVisible: false, approvalPosts: 0, continuedRequests: 0, quietWindowMs: 1000 };
          }
        }
        assert.deepEqual(await page.evaluate(() => window.__interactionQa.forbidden), []); assert.deepEqual(errors, []);
        const screenshot = join(artifacts, `error-${scenario.name}.png`); await page.screenshot({ path: screenshot, fullPage: true });
        evidence.push({ scenario: scenario.name, passed: true, controlledApi: true, screenshot, ...details });
      } catch (error) {
        const screenshot = join(artifacts, `failed-${scenario.name}.png`); await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        failures.push({ scenario: scenario.name, error: error.message, stack: error.stack, screenshot, errors });
      } finally { await page.close(); }
    }
  } finally { await context.close(); await writeFile(join(artifacts, 'evidence.json'), JSON.stringify({
    scope: 'controlled-api-browser-fixture', excludes: ['real-login', 'production-operations', 'ai-quality'], evidence, failures,
  }, null, 2)); }
  assert.deepEqual(failures, []);
  assert.equal(evidence.filter(row => row.width).length, smoke ? 1 : 15);
  assert.equal(evidence.filter(row => row.scenario === 'logout-clears-private-source').length, 1);
  assert.equal(evidence.filter(row => errorScenarios.some(scenario => scenario.name === row.scenario)).length, 4);
});

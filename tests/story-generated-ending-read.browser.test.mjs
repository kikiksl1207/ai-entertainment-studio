import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const enabled = process.env.STORY_GENERATED_ENDING_BROWSER_QA === '1';
const errorOnly = process.env.STORY_GENERATED_ENDING_QA_ERROR_ONLY === '1';
const repo = new URL('../', import.meta.url);
const artifacts = process.env.STORY_GENERATED_ENDING_QA_ARTIFACTS || 'E:/Codex/LuminaStage/ai-entertainment-studio-git/qa-artifacts/20261006-public-ending-read/browser-v1';
const temp = 'E:/Codex/LuminaStage/qa-temp/20261006-public-ending-read';
assert.match(artifacts, /^E:[/\\]Codex[/\\]LuminaStage[/\\](?:ai-entertainment-studio-git[/\\])?qa-artifacts[/\\]/i);
assert.ok(!artifacts.split(/[/\\]/).includes('..'));
const origin = 'https://ending-read-fixture.invalid';
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const words = { ko: '합성 결말의 문장입니다. 함께 열린 문 앞에서 이야기를 마쳤습니다.',
  en: 'This is a synthetic ending. The story ended beside the door they opened together.',
  ja: '合成の結末です。一緒に開いた扉の前で物語は終わりました。',
  'zh-Hans': '这是合成结局。他们在一起打开的门前结束了故事。',
  'zh-Hant': '這是合成結局。他們在一起打開的門前結束了故事。' };
const labels = { ko: ['읽기 완료', '읽기 완료됨'], en: ['Mark as read', 'Read'],
  ja: ['読了する', '読了済み'], 'zh-Hans': ['标记为已读', '已读'], 'zh-Hant': ['標記為已讀', '已讀'] };

function projection(locale, position = 0) {
  return { progressId: id(2), workId: id(3), revision: 7, status: 'completed', storyVersion: 1,
    activeReleaseId: id(4), currentGeneratedSceneId: id(5), currentAct: 1,
    currentBeatPosition: position, part: { id: id(6) }, choices: [],
    scene: { id: id(5), title: { value: words[locale] }, isGenerated: true, deliveryState: 'ready',
      endingType: 'ai_generated', visualManifest: { sceneKey: 'ai-synthetic-ending',
        background: { state: 'ready', publicAssetPath: '/assets/story/norse-myth-cover-portrait.webp' }, characters: [] },
      beats: Array.from({ length: 6 }, (_, index) => ({ id: id(10 + index), position: index + 1,
        type: 'paragraph', content: { value: `${index + 1}. ${words[locale]}`, locale, fallback: false } })) } };
}

// Real reader HTML, styles and controller with an isolated API and a known local bitmap.
// The bitmap and synthetic text are not evidence of generated artwork or model quality.
test('generated ending explicit read: actual desktop/mobile HTML and conservative recovery', { skip: !enabled, timeout: 240000 }, async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'E:/Codex/LuminaStage/qa-browsers';
  process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp;
  await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true });
  const html = await readFile(new URL('story-stage/index.html', repo), 'utf8');
  const resources = new Map();
  for (const file of ['styles.css', 'styles/story-stage.css', 'pages/story-canonical-read.js', 'pages/story-stage.js',
    'assets/brand/lumina-stage-logo.png', 'assets/story/norse-myth-cover-portrait.webp',
    'assets/fonts/SeoulNamsanM.ttf', 'assets/fonts/SeoulNamsanB.ttf', 'assets/fonts/SeoulNamsanEB.ttf']) {
    resources.set('/' + file, await readFile(new URL(file, repo)));
  }
  const evidence = { passed: false, cases: [], actualHtml: true, actualBrowser: true,
    syntheticApi: true, operatingChanged: false, realPhone: false, actualLogin: false, aiQuality: false,
    sourceHashes: Object.fromEntries([...resources].map(([file, bytes]) => [file, hash(bytes)])) };
  const { chromium } = createRequire(import.meta.url)('C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), { headless: true,
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  async function fixture({ width = 390, locale = 'en', mode = 'normal' } = {}) {
    const page = await context.newPage(), calls = [], errors = [], receipts = new Map();
    let current = projection(locale), postUsed = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(({ locale, user }) => {
      window.fixtureLocale = locale;
      window.luminaI18n = { getLocale: () => window.fixtureLocale };
      window.isLoggedIn = () => true;
      window.getAuth = () => ({ user: { id: user }, accessToken: 'synthetic-reader-token' });
      window.apiFetch = async (path, options = {}) => {
        const response = await fetch(`https://api.lumina-stage.com${path}`, { method: options.method || 'GET',
          headers: { Authorization: 'Bearer synthetic-reader-token', 'Content-Type': 'application/json' },
          body: options.body ? JSON.stringify(options.body) : undefined });
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error('Controlled fixture diagnostic'), { status: response.status, body });
        return body;
      };
    }, { locale, user: id(1) });
    function preview(fromPosition) {
      const members = current.scene.beats.filter(beat => beat.position >= fromPosition);
      const sourceTextHash = hash(JSON.stringify(members.map(beat => [beat.id, beat.position,
        beat.content.value.replace(/\\r\\n|\\n|\\r/gu, '\n')])));
      const scopeChecksum = hash(JSON.stringify([id(1), current.progressId, current.scene.id, current.activeReleaseId,
        locale, fromPosition, sourceTextHash]));
      return { contract: 'story-generated-ending-read-review-v1', progressId: current.progressId,
        workId: current.workId, sceneId: current.scene.id, locale, fromPosition, throughPosition: members.at(-1).position,
        expectedRevision: current.revision, scopeChecksum, sourceTextHash, confirmation: receipts.get(scopeChecksum) || null };
    }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) {
        if (url.pathname === '/story-stage') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        if (resources.has(url.pathname)) {
          const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript'
            : url.pathname.endsWith('.png') ? 'image/png' : url.pathname.endsWith('.webp') ? 'image/webp' : 'font/ttf';
          return route.fulfill({ contentType: type, body: resources.get(url.pathname) });
        }
        if (request.resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.abort();
      }
      if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'private, no-store' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const method = request.method(), body = method === 'POST' ? request.postDataJSON() : null;
      calls.push({ path: url.pathname, method, body });
      let value, status = 200;
      if (url.pathname.endsWith('/current-scene')) value = current;
      else if (url.pathname.endsWith('/progress-state')) value = { canFullReset: false, canActReset: false };
      else if (url.pathname.endsWith('/beat')) {
        assert.deepEqual(Object.keys(body).sort(), ['expectedRevision', 'position']);
        assert.equal(body.expectedRevision, current.revision);
        current = { ...current, revision: current.revision + 1, currentBeatPosition: body.position };
        value = current;
      } else if (url.pathname.endsWith('/generated-ending-read')) {
        value = preview(Number(url.searchParams.get('fromPosition')));
        if (mode === 'denied') { status = 403; value = { error: { code: 'PRIVATE_FIXTURE_ONLY' } }; }
        if (mode === 'stale') value.expectedRevision++;
      } else if (url.pathname.endsWith('/generated-ending-read/confirm')) {
        assert.equal(postUsed, false, 'An uncertain write must not be automatically posted again');
        postUsed = true;
        const pin = preview(body.fromPosition);
        assert.equal(body.expectedRevision, current.revision);
        assert.equal(body.expectedScopeChecksum, pin.scopeChecksum);
        assert.equal(body.expectedSourceTextHash, pin.sourceTextHash);
        assert.equal(body.displayedAndRead, true);
        assert.deepEqual(Object.keys(body).sort(), ['displayedAndRead', 'expectedRevision', 'expectedScopeChecksum',
          'expectedSourceTextHash', 'fromPosition', 'idempotencyKey', 'locale']);
        assert.match(body.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        value = { ...pin, contract: 'story-generated-ending-read-receipt-v1', receiptId: id(50),
          progressRevision: current.revision, confirmedAt: '2026-10-05T17:00:00.000Z', idempotentReplay: false,
          progressMutated: false, generationStarted: false, imageGenerationStarted: false,
          meaningApproved: false, qualityApproved: false, publicationStarted: false };
        delete value.confirmation; delete value.expectedRevision;
        if (mode !== 'uncommitted') receipts.set(pin.scopeChecksum, value);
        if (['lost-response', 'uncommitted'].includes(mode)) { status = 500; value = { error: { code: 'PRIVATE_FIXTURE_ONLY' } }; }
      } else throw new Error(`Unexpected external/action path ${url.pathname}`);
      await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    });
    await page.goto(`${origin}/story-stage?sessionId=${id(2)}&workId=${id(3)}`);
    await page.evaluate(() => document.body.classList.remove('is-booting'));
    await page.locator('.story-player-copy').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const posts = () => calls.filter(row => row.method === 'POST' && row.path.endsWith('/confirm'));
    return { page, calls, errors, receipts, posts, current: () => current,
      async last() {
        for (let index = 0; index < 2; index++) {
          await page.locator('[data-story-beat="next"]').click();
          await page.waitForFunction(({ text, mayBlock }) => document.querySelector('[data-story-beat-counter]')?.textContent === text ||
            (mayBlock && !document.querySelector('.story-player-copy')), { text: `${index + 2} / 3`, mayBlock: mode === 'denied' && index === 1 });
        }
      }, async close() { await page.close(); } };
  }
  async function settled(page, saved) {
    await page.waitForFunction(({ expected, disabled }) => {
      const button = document.querySelector('[data-story-ending-read]');
      return button?.textContent === expected && button.disabled === disabled;
    }, { expected: saved ? labels[await page.evaluate(() => window.fixtureLocale)][1]
      : labels[await page.evaluate(() => window.fixtureLocale)][0], disabled: saved }, { timeout: 6000 });
  }
  async function fit(page, width) {
    const button = page.locator('[data-story-ending-read]');
    await button.evaluate(node => node.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
    return button.evaluate(node => {
      const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth,
        textFits: node.scrollWidth <= node.clientWidth + 1, hit: hit?.className || hit?.tagName || null,
        uncovered: node === hit || node.contains(hit), pageFits: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
  }
  try {
    for (const width of errorOnly ? [] : [390, 1280]) for (const locale of locales) {
      const f = await fixture({ width, locale });
      try {
        assert.equal(await f.page.locator('[data-story-ending-read]').count(), 0);
        await f.last(); await settled(f.page, false);
        assert.equal(f.posts().length, 0, 'Reaching the last cursor is not an explicit read');
        assert.equal(f.current().currentBeatPosition, 6);
        const paragraphs = await f.page.locator('.story-player-copy p').allTextContents();
        assert.deepEqual(paragraphs, [5, 6].map(n => `${n}. ${words[locale]}`));
        const image = await f.page.locator('.story-player-background').evaluate(node => ({ width: node.naturalWidth, height: node.naturalHeight, hidden: node.hidden }));
        assert.ok(image.width > 0 && image.height > 0 && !image.hidden);
        const before = { revision: f.current().revision, cursor: f.current().currentBeatPosition };
        const fitBefore = await fit(f.page, width);
        const pendingShot = join(artifacts, `ending-${width}-${locale}-unconfirmed.png`);
        await f.page.screenshot({ path: pendingShot });
        assert.ok(fitBefore.left >= 0 && fitBefore.right <= width + 1 && fitBefore.textFits && fitBefore.uncovered && fitBefore.pageFits, JSON.stringify(fitBefore));
        await f.page.locator('[data-story-ending-read]').click(); await settled(f.page, true);
        assert.equal(f.posts().length, 1); assert.equal(f.receipts.size, 1);
        assert.deepEqual({ revision: f.current().revision, cursor: f.current().currentBeatPosition }, before);
        const fitAfter = await fit(f.page, width);
        assert.ok(fitAfter.textFits && fitAfter.uncovered && fitAfter.pageFits);
        const savedShot = join(artifacts, `ending-${width}-${locale}-confirmed.png`);
        await f.page.screenshot({ path: savedShot });
        await f.page.locator('[data-story-beat="previous"]').click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-beat-counter]')?.textContent === '2 / 3');
        await f.page.locator('[data-story-beat="next"]').click(); await settled(f.page, true);
        assert.equal(f.posts().length, 1, 'Returning only checks the same receipt');
        assert.deepEqual(f.errors, []);
        evidence.cases.push({ width, locale, exactVisibleText: true, knownBitmapLoaded: image,
          explicitPostCount: 1, confirmationDoesNotNavigate: true, receiptSurvivesNavigation: true,
          fitBefore, fitAfter, screenshots: [pendingShot, savedShot] });
      } finally { await f.close(); }
    }
    for (const mode of ['lost-response', 'uncommitted', 'denied', 'stale']) {
      const f = await fixture({ mode });
      try {
        await f.last();
        if (mode === 'denied') {
          await f.page.waitForFunction(() => !document.querySelector('.story-player-copy') && !document.querySelector('[data-story-ending-read]'));
          assert.equal(f.posts().length, 0);
        } else if (mode === 'stale') {
          await f.page.locator('[data-story-ending-read-refresh]').waitFor();
          assert.equal(await f.page.locator('[data-story-ending-read]').isDisabled(), true);
          assert.equal(f.posts().length, 0);
        } else {
          await settled(f.page, false); await f.page.locator('[data-story-ending-read]').click();
          if (mode === 'lost-response') await settled(f.page, true);
          else {
            await f.page.waitForFunction(() => document.querySelector('[data-story-ending-read]')?.textContent === 'Check read confirmation');
            const before = f.calls.filter(call => call.path.endsWith('/generated-ending-read')).length;
            await f.page.locator('[data-story-ending-read]').click();
            await f.page.waitForFunction(() => document.querySelector('[data-story-ending-read]')?.textContent === 'Check read confirmation');
            assert.ok(f.calls.filter(call => call.path.endsWith('/generated-ending-read')).length > before);
            assert.equal(f.receipts.size, 0);
          }
          assert.equal(f.posts().length, 1, 'Lost response uses GET only, no retrying the POST');
        }
        assert.deepEqual(f.errors, []);
        evidence.cases.push({ mode, width: 390, locale: 'en', confirmationPosts: f.posts().length,
          diagnosticNotRendered: !(await f.page.locator('#storyStageRoot').textContent()).includes('PRIVATE_FIXTURE_ONLY'),
          savedReceiptCount: f.receipts.size, postReplay: false });
      } finally { await f.close(); }
    }
    evidence.passed = true;
  } catch (error) {
    evidence.failure = String(error.stack || error);
    throw error;
  } finally {
    await context.close(); evidence.browserClosed = true;
    await writeFile(join(artifacts, 'browser-evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  }
});

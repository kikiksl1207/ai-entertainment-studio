import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const enabled = process.env.CREATOR_INTERACTIONS_BROWSER_QA === '1';
const root = new URL('../', import.meta.url);
const artifacts = 'E:/Codex/LuminaStage/qa-artifacts/20261001-creator-interactions-entry';
const temp = 'E:/Codex/LuminaStage/qa-tmp/20261001-creator-interactions-entry';
const origin = 'https://creator-entry-fixture.invalid';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pin = { ownerUserId: id(1), workId: id(2), releaseId: id(3), releaseChecksum: 'a'.repeat(64),
  manuscriptVersionId: id(4), manuscriptHash: 'b'.repeat(64), artistId: id(5), beatId: id(6), sceneId: id(7), partId: id(8),
  identityProfileId: id(9), sourceChecksum: 'c'.repeat(64), identityPinHash: 'd'.repeat(64) };

// Real entry HTML/styles, controlled admitted identity/API, and no other page controller execution.
test('canonical review fits the existing Creator Studio entry and global styles', { skip: !enabled, timeout: 90000 }, async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'E:/Codex/LuminaStage/qa-browsers';
  process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp;
  await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true });
  const html = await readFile(new URL('creator-studio/index.html', root), 'utf8');
  const allowed = new Set(['/styles.css', '/styles/creator-studio.css', '/creator-story-visual-references.css',
    '/pages/creator-story-visual-review.css', '/pages/creator-story-visual-booking.css',
    '/pages/creator-story-choice-consent-review.css', '/pages/creator-story-interactions.css', '/pages/creator-branch-visual-review.css']);
  const resources = new Map();
  for (const path of allowed) resources.set(path, await readFile(new URL(path.slice(1), root), 'utf8'));
  resources.set('/pages/creator-story-interactions.js', await readFile(new URL('pages/creator-story-interactions.js', root), 'utf8'));
  const { chromium } = createRequire(import.meta.url)('C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), { headless: true,
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  const evidence = [];
  try {
    for (const width of [390, 1280]) for (const locale of ['ko', 'en']) {
      const page = await context.newPage(); const errors = [], styles = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(({ pin, locale }) => {
        window.luminaI18n = { getLocale: () => locale };
        const identity = () => ({ ownerId: pin.ownerUserId, epoch: 1 });
        const sourceText = locale === 'ko' ? '아스터는 함께 문을 열었다. 두 사람은 안으로 들어갔다.' : 'Aster opened the door together. They entered the room.';
        window.__entryCommands = 0;
        window.LuminaCreatorStudioApi = { identity, isCurrent: value => value?.ownerId === pin.ownerUserId && value.epoch === 1,
          fetch: async (url, options = {}) => {
            if (!options.identity || options.identity.ownerId !== pin.ownerUserId || options.identity.epoch !== 1) throw new Error('Context');
            if (options.method === 'POST') { window.__entryCommands++; throw new Error('No mutation permitted in layout fixture'); }
            const address = new URL(url, location.href); let data;
            if (address.pathname === '/api/v1/me/creator-studio/stories') data = { items: [{ workId: pin.workId, title: { value: 'Synthetic canonical review story' },
              publication: { published: true, status: 'published', activeReleaseId: pin.releaseId } }], nextCursor: null };
            else if (address.pathname.endsWith('/artist-candidates')) data = { engaged: [], searchResults: [{ artistId: pin.artistId, displayName: 'Aster', visualIdentityReady: true }] };
            else if (address.pathname.endsWith('/interactions/beats')) data = { contract: 'story-canonical-interaction-catalog-v1', ...pin, locale,
              items: [{ beatId: pin.beatId, sceneId: pin.sceneId, partId: pin.partId, partPosition: 1, scenePosition: 1, beatPosition: 1,
                beatType: 'narration', sourceText, sourceAvailable: true }], nextAfterBeatId: null };
            else if (address.pathname.endsWith(`/interactions/beats/${pin.beatId}`)) data = { contract: 'story-canonical-interaction-review-v1',
              identity: { ...pin, locale }, sourceText, artistDisplayName: 'Aster', approvals: [], moreApprovals: false, proposalApproved: false, readerMemoryApplied: false };
            else throw new Error('Unexpected request');
            return { ok: true, json: async () => data };
          } };
      }, { pin, locale });
      await page.route('**/*', route => {
        const address = new URL(route.request().url());
        if (address.origin !== origin) return route.abort();
        if (address.pathname === '/creator-studio') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        if (resources.has(address.pathname)) {
          if (allowed.has(address.pathname)) styles.push(address.pathname);
          return route.fulfill({ contentType: allowed.has(address.pathname) ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8', body: resources.get(address.pathname) });
        }
        if (route.request().resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.abort();
      });
      try {
        await page.goto(`${origin}/creator-studio`);
        await page.evaluate(locale => {
          document.documentElement.lang = locale; document.body.classList.remove('is-booting');
          document.getElementById('studioAccessGate').hidden = true;
          document.getElementById('studioShell').hidden = false;
          for (const section of document.querySelectorAll('.studio-section')) section.classList.toggle('is-active', section.id === 'writer-manuscript');
          window.dispatchEvent(new Event('focus'));
        }, locale);
        await page.locator('[data-interaction-action="works"]').click();
        await page.locator('[data-interaction-work]').selectOption(pin.workId);
        await page.locator('[data-interaction-locale]').selectOption(locale);
        await page.locator('[data-interaction-action="source"]').click();
        await page.locator('[data-interaction-beat]').selectOption(pin.beatId);
        await page.locator('[data-interaction-action="search"]').click();
        await page.locator('[data-interaction-artist]').selectOption(pin.artistId);
        await page.locator('[data-interaction-action="review"]').click();
        await page.locator('[data-interaction-evidence-source]').waitFor();
        assert.equal(await page.locator('[data-interaction-source]').count(), 0);
        const fit = await page.locator('#writerInteractions').evaluate(host => ({ host: host.getBoundingClientRect().toJSON(), width: innerWidth,
          nodes: [...host.querySelectorAll('button, select, textarea, input')].map(node => node.getBoundingClientRect().toJSON()),
          sourceColor: getComputedStyle(host.querySelector('textarea')).color,
          sourceBackground: getComputedStyle(host.querySelector('textarea')).backgroundColor }));
        assert.ok(fit.host.width > 0 && fit.host.left >= 0 && fit.host.right <= width + 1);
        for (const rect of fit.nodes) assert.ok(rect.width > 0 && rect.left >= fit.host.left - 1 && rect.right <= fit.host.right + 1);
        assert.notEqual(fit.sourceColor, fit.sourceBackground);
        await page.locator('[data-interaction-memory]').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const accessible = await page.locator('[data-interaction-memory]').evaluate(node => {
          const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { uncovered: node === hit || node.contains(hit), top: rect.top, bottom: rect.bottom, hit: hit?.tagName || null };
        });
        assert.equal(accessible.uncovered, true, `Fixed navigation must not cover the focused summary: ${JSON.stringify(accessible)}`);
        assert.equal(await page.evaluate(() => window.__entryCommands), 0);
        assert.deepEqual(new Set(styles), allowed); assert.deepEqual(errors, []);
        const screenshot = join(artifacts, `entry-${width}-${locale}.png`);
        await page.locator('#writerInteractions').screenshot({ path: screenshot });
        evidence.push({ width, locale, hostFit: true, controlsFit: true, summaryUncovered: true, styles: [...styles], screenshot, commands: 0, otherPageControllers: false, actualLogin: false });
      } finally { await page.close(); }
    }
  } finally { await context.close(); await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
  assert.equal(evidence.length, 4);
});

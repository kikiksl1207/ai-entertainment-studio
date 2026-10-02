import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const bootstrap = `
window.LUMINA_API_BASE = location.origin;
window.LuminaBackstageApi = { fetch: async (url) => {
  const address = new URL(url, location.origin), pathname = address.pathname;
  const pair = { workId: address.searchParams.get('workId'), releaseId: address.searchParams.get('releaseId') };
  if (url.endsWith('/submissions')) return { items: [], publishedWorks: [
    { id: '10000000-0000-4000-8000-000000000001', activeReleaseId: '20000000-0000-4000-8000-000000000001', slug: 'the-monster-that-did-not-eat-my-name', status: 'published' },
    { id: '10000000-0000-4000-8000-000000000002', activeReleaseId: '20000000-0000-4000-8000-000000000002', slug: 'we-wrote-rebellion-on-each-others-bodies', status: 'published' }
  ] };
  if (pathname.endsWith('/published/monster/ai-status')) return { ...pair, status: 'active', active: true,
    choicePreparation: { totalParts: 32, preparedParts: 0, remainingParts: 32, ready: false, phase: 'preparing' } };
  if (pathname.endsWith('/published/rebellion/ai-status')) return { ...pair, status: 'active', active: true,
    choicePreparation: { totalParts: 44, preparedParts: 44, remainingParts: 0, ready: true, phase: 'ready' } };
  if (pathname.endsWith('/published/monster/choice-coverage')) return { ...pair, status: 'ready', totalParts:32, totalScenes: 32,
    partsWithoutScenes: 0, routeIssues: { duplicateImmediateTargets:0, invalidDirectTargets:0 }, distribution: { zero: 0, one: 32, two: 0, threeValid: 0, otherOrInvalid: 0 },
    incompleteExamples: [{ partPosition: 2, sceneKey: 'part-02-scene-01', choiceCount: 1 }] };
  if (pathname.endsWith('/published/rebellion/choice-coverage')) return { ...pair, status: 'ready', totalParts:44, totalScenes: 44,
    partsWithoutScenes: 0, routeIssues: { duplicateImmediateTargets:0, invalidDirectTargets:0 }, distribution: { zero: 0, one: 0, two: 0, threeValid: 44, otherOrInvalid: 0 },
    incompleteExamples: [] };
  if (url.endsWith('/replacement-status')) return { status: 'ready', readyCount: 9, staleCount: 9,
    workId: url.includes('10000000-0000-4000-8000-000000000001') ? '10000000-0000-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000002',
    releaseId: url.includes('10000000-0000-4000-8000-000000000001') ? '20000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
    releaseChecksum: '${'c'.repeat(64)}',
    items: Array.from({ length: 9 }, (_, index) => ({
      sourceSceneKey: 'part-02-scene-' + String(index + 1).padStart(2, '0'),
      assetId: '97a030d5-477c-47d0-a46c-f50a98e7789b'
    })) };
  return { status: 'unavailable' };
} };
`;

function server() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="ko"><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/backstage.css"><link rel="stylesheet" href="/backstage-story-publication.css">
        </head><body><div id="backstageDashboardView"><nav class="sidebar-nav"><a href="#story-publication">스토리 공개</a></nav>
        <main class="dashboard-main" data-active-section="story-publication"><div id="storyPublicationStatusCards" class="story-publication-status-grid"></div>
        <div id="storyPublicationSubmissionList"></div><p id="storyPublicationState"></p></main></div>
        <script>${bootstrap}</script><script src="/backstage-story-publication.js"></script>
        <script>document.querySelector('.sidebar-nav a').click();</script></body></html>`);
      return;
    }
    if (['/backstage.css', '/backstage-story-publication.css', '/backstage-story-publication.js'].includes(path)) {
      const data = await readFile(root + path);
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(data);
      return;
    }
    response.writeHead(404).end();
  });
}

test('choice coverage stays inside its story card at PC and mobile widths', { timeout: 90_000 }, async () => {
  const site = server();
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    for (const width of [390, 820, 1280, 1750]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(`http://127.0.0.1:${site.address().port}/`);
      const monster = page.locator('.story-publication-status-item').filter({ hasText: '내 이름을 먹지 않은 괴물' });
      await monster.locator('[data-story-choice-coverage="monster"]').getByText('미완료 장면 있음').waitFor();
      await monster.locator('.story-visual-review-row').first().waitFor();
      const layout = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.story-publication-status-item')]
          .find((item) => item.textContent.includes('내 이름을 먹지 않은 괴물'));
        const controls = card.querySelector('.story-publication-controls');
        const coverage = card.querySelector('[data-story-choice-coverage="monster"]');
        const ai = card.querySelector('[data-story-ai-card="monster"]');
        const box = (element) => element.getBoundingClientRect().toJSON();
        const cards = [...document.querySelectorAll('.story-publication-status-item')].map(box);
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, cards,
          card: box(card), controls: box(controls), coverage: box(coverage), ai: box(ai),
          directChildren: card.children.length };
      });
      assert.ok(layout.pageWidth <= width, `horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.cards.every((item) => item.left >= -1 && item.right <= width + 1),
        `story card escaped viewport at ${width}: ${JSON.stringify(layout)}`);
      assert.equal(layout.directChildren, 3);
      assert.ok(layout.coverage.left >= layout.controls.left - 1);
      assert.ok(layout.coverage.right <= layout.controls.right + 1);
      assert.ok(layout.ai.top >= layout.coverage.bottom - 1);
      assert.match(await monster.innerText(), /0 \/ 32파트 선택지 준비/);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => site.close(resolve));
  }
});

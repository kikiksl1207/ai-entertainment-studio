import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.STORY_UI_ARTIFACTS;
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const A = '7d4a6f54-a9ea-490e-bb94-379faf262fd0', B = 'e845491f-efcf-407a-bc86-5cdb2efb48fa';
const releaseA = 'e8444d61-bff2-4bdd-b8b2-f38a4b3b541b', releaseB = '297f482c-b843-4d0c-b4dd-18270159c107';
const releaseNew = '80d784cc-d82f-48a1-8f80-a4c1b4a1d810';
const checksum = 'b'.repeat(64);
const bootstrap = String.raw`
const A='${A}', B='${B}', releaseA='${releaseA}', releaseB='${releaseB}', checksum='${checksum}';
window.requests=[]; window.active={[A]:true,[B]:false}; window.stale={[A]:[],[B]:['part-001-main','part-002-main']};
window.holdA=false; window.resolvers=[]; window.readMismatch=null; window.postMismatch=false;
window.failVisual=false; window.holdPost=false; window.failActivate=false;
window.catalog=[{id:A,slug:'the-killer-inherits-the-dead-source-a',activeReleaseId:releaseA,status:'published'},
 {id:B,slug:'the-killer-inherits-the-dead-source-b',activeReleaseId:releaseB,status:'published'}];
if(new URL(location.href).searchParams.get('reverse')==='true') window.catalog.reverse();
window.LuminaBackstageApi={fetch:async(url,options={})=>{
 window.requests.push({url,method:options.method||'GET',body:options.body});
 const path=new URL(url,location.href), name=path.pathname.split('/').at(-1);
 if(name==='submissions')return {items:[],publishedWorks:window.catalog};
 const workId=path.searchParams.get('workId') || path.pathname.match(/story-visuals\/([^/]+)/)?.[1];
 const releaseId=path.searchParams.get('releaseId') || window.catalog.find(w=>w.id===workId)?.activeReleaseId;
 const pair={workId,releaseId};
 if(options.method==='POST'){
  if(window.holdPost)await new Promise(resolve=>{window.resolvePost=resolve;});
  const id=options.body.workId || workId;
  if(name==='activate-ai'){
   if(window.failActivate)throw new Error('Uncertain request outcome');
   window.active[id]=true;
   return {workId:window.postMismatch?A:id,releaseId:window.postMismatch?releaseA:options.body.releaseId,status:'active',active:true};
  }
  if(name==='replace-stale'){
   if(window.failVisual)throw new Error('Uncertain request outcome');
   window.stale[id]=window.stale[id].filter(scene=>scene!==options.body.sourceSceneKey);
   return {workId:window.postMismatch?A:id,releaseId:window.postMismatch?releaseA:options.body.releaseId,
    releaseChecksum:options.body.releaseChecksum,sourceSceneKey:options.body.sourceSceneKey,status:'ready',reused:false,publicAssetPath:'/mock.webp'};
  }
  throw new Error('Unexpected mutation');
 }
 let value;
 if(name==='choice-status')value={...pair,status:'ready',preparedParts:265,totalParts:265,preparationBatch:null,pending:[]};
 else if(name==='ai-status')value={...pair,status:window.active[workId]?'active':'inactive',active:window.active[workId]===true};
 else if(name==='choice-coverage')value={...pair,status:'ready',totalParts:265,totalScenes:265,partsWithoutScenes:0,
  distribution:{zero:0,one:0,two:0,threeValid:265,otherOrInvalid:0},routeIssues:{duplicateImmediateTargets:0,invalidDirectTargets:0},incompleteExamples:[]};
 else if(name==='replacement-status')value={...pair,releaseChecksum:checksum,readyCount:2,staleCount:window.stale[workId]?.length||0,
  items:(window.stale[workId]||[]).map(sourceSceneKey=>({sourceSceneKey,assetId:''}))};
 else return {status:'unavailable',active:false};
 if(window.readMismatch===name)value={...value,workId:A,releaseId:releaseA};
 if(window.holdA && workId===A && name!=='choice-status')return new Promise(resolve=>window.resolvers.push(()=>resolve(value)));
 return value;
}};`;

function server() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="ko"><head>
      <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/backstage.css">
      <link rel="stylesheet" href="/backstage-story-publication.css"></head><body><div id="backstageDashboardView">
      <nav class="sidebar-nav"><a href="#story-publication">스토리 공개</a></nav><main class="dashboard-main" data-active-section="story-publication">
      <button id="storyPublicationRefreshButton">새로고침</button><div id="storyPublicationStatusCards" class="story-publication-status-grid"></div>
      <div id="storyPublicationSubmissionList"></div><p id="storyPublicationState" role="status"></p></main></div>
      <script>${bootstrap}</script><script src="/backstage-story-publication.js"></script><script>document.querySelector('.sidebar-nav a').click();</script></body></html>`);
    else if (['/backstage.css', '/backstage-story-publication.css', '/backstage-story-publication.js'].includes(path)) {
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(await readFile(root + path));
    } else response.writeHead(404).end();
  });
}

async function select(page, id) {
  await page.locator('[data-story-choice-target]').selectOption(id);
  await page.waitForFunction(id => document.querySelector('[data-story-choice-target]').value === id &&
    document.querySelector('[data-story-ai-card="inheritor"] fieldset')?.disabled === false, id);
}

async function confirm(page) {
  for (const input of await page.locator('[data-story-ai-card="inheritor"] [data-story-ai-confirm]').all()) await input.check();
}

async function assertUncovered(button) {
  await button.scrollIntoViewIfNeeded();
  const result = await button.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const covering = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { uncovered: element.contains(covering), rect: rect.toJSON(), covering: covering?.outerHTML };
  });
  assert.equal(result.uncovered, true, `action is covered: ${JSON.stringify(result)}`);
}

test('selected AI approval and visual replacements stay pinned across PC/mobile and stale or uncertain replies', { timeout: 180000 }, async () => {
  const site = server(); await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    if (artifacts) await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const open = async (width = 390, reverse = false) => {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      page.errors = []; page.on('pageerror', error => page.errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(`http://127.0.0.1:${site.address().port}/?reverse=${reverse}`);
      try {
        await page.locator('#storyPublicationState').getByText('0건을 확인했습니다.', { exact: false }).waitFor({ timeout: 5000 });
      } catch (error) {
        throw new Error(`${error.message}\nPage errors: ${JSON.stringify(page.errors)}\n${await page.locator('body').innerText()}`);
      }
      return page;
    };
    for (const width of [390, 400, 1280]) for (const reverse of [false, true]) {
      const page = await open(width, reverse);
      assert.equal((await page.evaluate(() => window.requests.filter(x => /inheritor\/(ai-status|choice-coverage)/.test(x.url)))).length, 0);
      await select(page, B);
      const ai = page.locator('[data-story-ai-card="inheritor"]'), visual = page.locator('[data-story-visual-card="inheritor"]');
      assert.match(await ai.innerText(), /비활성/);
      const reads = await page.evaluate(() => window.requests.filter(x => /inheritor\/(ai-status|choice-coverage)/.test(x.url)));
      for (const read of reads) {
        const params = new URL(read.url, 'http://localhost').searchParams;
        assert.equal(params.get('workId'), B); assert.equal(params.get('releaseId'), releaseB);
      }
      assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 0);
      await confirm(page); await select(page, A);
      assert.equal(await ai.locator('[data-story-ai-confirm]:checked').count(), 0);
      await select(page, B); await confirm(page);
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
        boxes: [...document.querySelectorAll('[data-story-ai-card="inheritor"], [data-story-visual-card="inheritor"], [data-story-ai-card="inheritor"] button, [data-story-visual-card="inheritor"] button')].map(el => el.getBoundingClientRect().toJSON()) }));
      assert.ok(layout.width <= width, `page overflow ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.boxes.every(box => box.left >= -1 && box.right <= width + 1), `clipped controls ${width}`);
      if (artifacts && !reverse) await ai.locator('..').screenshot({ path: `${artifacts}/selected-actions-${width}.png` });
      await assertUncovered(ai.locator('[data-story-ai-activate]'));
      await page.evaluate(() => { window.holdPost = true; });
      await ai.locator('[data-story-ai-activate]').click();
      await page.waitForFunction(() => typeof window.resolvePost === 'function');
      assert.equal(await page.locator('[data-story-choice-target]').isDisabled(), true);
      assert.equal(await page.locator('#storyPublicationRefreshButton').isDisabled(), true);
      await page.evaluate(() => { window.holdPost = false; window.resolvePost(); });
      await page.waitForFunction(() => window.requests.filter(x => /activate-ai$/.test(x.url)).length === 1 &&
        document.querySelector('[data-story-choice-target]').disabled === false);
      const activation = await page.evaluate(() => window.requests.find(x => /activate-ai$/.test(x.url)));
      assert.deepEqual(activation.body, { workId: B, releaseId: releaseB, aiBranchGenerationConfirmed: true,
        authorStyleReferenceConfirmed: true, generatedResultReuseConfirmed: true, imageTransformationConfirmed: true });
      const replaceButton = visual.locator('[data-story-visual-replace]:not([data-story-visual-scene])');
      await assertUncovered(replaceButton);
      if (artifacts && !reverse && width < 500) await page.screenshot({ path: `${artifacts}/selected-actions-viewport-${width}.png` });
      await replaceButton.click();
      await page.waitForFunction(() => window.requests.filter(x => /replace-stale$/.test(x.url)).length === 2 &&
        document.querySelector('[data-story-choice-target]').disabled === false);
      const replacements = await page.evaluate(() => window.requests.filter(x => /replace-stale$/.test(x.url)));
      for (const [index, replacement] of replacements.entries()) {
        assert.equal(replacement.url, `/admin/api/v1/story-visuals/${B}/replace-stale`);
        assert.deepEqual(replacement.body, { releaseId: releaseB, releaseChecksum: checksum, sourceSceneKey: `part-00${index + 1}-main` });
      }
      assert.deepEqual(page.errors, []); await page.close();
    }
    const page = await open();
    await page.evaluate(() => { window.holdA = true; });
    await page.locator('[data-story-choice-target]').selectOption(A);
    await page.waitForFunction(() => window.resolvers.length === 3);
    await select(page, B);
    const before = await page.locator('[data-story-ai-card="inheritor"]').innerText();
    await page.evaluate(() => { for (const resolve of window.resolvers) resolve(); });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('[data-story-ai-card="inheritor"]').innerText(), before);
    await page.evaluate(({ id, release }) => { window.catalog = window.catalog.map(w => w.id === id ? { ...w, activeReleaseId: release } : w); }, { id: B, release: releaseNew });
    await page.locator('#storyPublicationRefreshButton').click();
    await page.locator('[data-story-choice-target-state]').getByText('변경되었습니다.', { exact: false }).waitFor();
    assert.equal(await page.locator('[data-story-ai-card="inheritor"] [data-story-ai-confirm]:checked').count(), 0);
    assert.equal(await page.locator('[data-story-ai-card="inheritor"] [data-story-ai-confirm]').first().isDisabled(), true);
    assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 0);
    await page.close();
    for (const failure of ['read-ai', 'read-visual', 'post-activate', 'post-visual', 'uncertain-activate', 'uncertain-visual']) {
      const p = await open();
      if (failure.startsWith('read-')) {
        await p.evaluate(kind => { window.readMismatch = kind === 'read-ai' ? 'ai-status' : 'replacement-status'; }, failure);
        await p.locator('[data-story-choice-target]').selectOption(B);
        await p.locator(failure === 'read-ai' ? '[data-story-ai-card="inheritor"] [data-story-ai-status]' :
          '[data-story-visual-card="inheritor"] [data-story-visual-status]').getByText('확인하지 못했습니다.', { exact: false }).waitFor();
        const selector = failure === 'read-ai' ? '[data-story-ai-card="inheritor"] [data-story-ai-activate]' : '[data-story-visual-card="inheritor"] [data-story-visual-replace]';
        const buttons = p.locator(selector);
        for (const button of await buttons.all()) assert.equal(await button.isDisabled(), true);
        assert.equal((await p.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 0);
      } else {
        await select(p, B); await confirm(p);
        await p.evaluate(kind => { window.postMismatch = kind.startsWith('post-'); window.failVisual = kind === 'uncertain-visual'; window.failActivate = kind === 'uncertain-activate'; }, failure);
        const selector = failure.endsWith('activate') ? '[data-story-ai-card="inheritor"] [data-story-ai-activate]' : '[data-story-visual-card="inheritor"] [data-story-visual-replace]:not([data-story-visual-scene])';
        await p.locator(selector).click();
        await p.waitForFunction(() => window.requests.filter(x => x.method === 'POST').length === 1 &&
          document.querySelector('[data-story-choice-target]').disabled === false);
        assert.equal((await p.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 1);
        if (await p.locator(selector).count()) {
          assert.equal(await p.locator(selector).isDisabled(), true);
          await p.locator(selector).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        }
        await p.waitForTimeout(30);
        assert.equal((await p.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 1);
      }
      assert.deepEqual(p.errors, []); await p.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => site.close(resolve)); }
});

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
const slugs = {
  imjin: 'records-of-the-burning-sea-imjin-war', norse: 'norse-myth-loki-crossroads',
  monster: 'the-monster-that-did-not-eat-my-name', rebellion: 'we-wrote-rebellion-on-each-others-bodies'
};
const works = Object.entries(slugs).map(([key, slug], index) => ({ key, slug, status: 'published',
  id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  activeReleaseId: `20000000-0000-4000-8000-00000000000${index + 1}` }));
const checksum = 'c'.repeat(64);
const bootstrap = String.raw`
window.catalog=${JSON.stringify(works)}; window.requests=[]; window.stale={}; window.active={}; window.progress={};
for(const work of window.catalog){window.stale[work.id]=[work.key+'-one',work.key+'-two'];
 window.active[work.id]=false; window.progress[work.id]={totalParts:2,preparedParts:2,remainingParts:0,ready:true,phase:'ready'};}
window.failure=null; window.holdPost=false; window.resolvePost=null; window.aiFailure=null; window.aiHeld=false; window.aiResolve=null;
window.LuminaBackstageApi={fetch:async(url,options={})=>{
 window.requests.push({url,method:options.method||'GET',body:options.body});
 const path=new URL(url,location.href), name=path.pathname.split('/').at(-1);
 if(name==='submissions')return {items:[],publishedWorks:window.catalog};
 const segments=path.pathname.split('/'), id=path.searchParams.get('workId')||options.body?.workId||segments[segments.indexOf('story-visuals')+1];
 const work=window.catalog.find(item=>item.id===id);
 if(options.method==='POST'){
  if(name==='activate-ai'){
   if(window.aiHeld)await new Promise(resolve=>{window.aiResolve=resolve;});
   if(window.aiFailure==='uncertain')throw new Error('Uncertain AI outcome');
   const progress=window.progress[id];
   if(progress.ready||progress.phase==='awaiting_promotion'){
    progress.ready=true;progress.phase='ready';window.active[id]=true;
   }else{progress.preparedParts=Math.min(progress.totalParts,progress.preparedParts+8);
    progress.remainingParts=progress.totalParts-progress.preparedParts;
    progress.phase=progress.remainingParts?'preparing':'awaiting_promotion';}
   const result={workId:id,releaseId:options.body.releaseId,status:progress.ready?'active':'preparing_choices',
    active:window.active[id],...progress};
   if(window.aiFailure==='post-pair')return {...result,releaseId:'30000000-0000-4000-8000-000000000001'};
   if(window.aiFailure==='post-counts')return {...result,preparedParts:-1,status:'preparing_choices'};
   if(window.aiFailure==='source-change')work.activeReleaseId='30000000-0000-4000-8000-000000000001';
   return result;
  }
  if(name!=='replace-stale')throw new Error('Unexpected mutation');
  if(window.holdPost)await new Promise(resolve=>{window.resolvePost=resolve;});
  if(window.failure==='uncertain')throw new Error('Uncertain provider outcome');
  const result={workId:id,...options.body,status:'ready',reused:false,publicAssetPath:'/mock.webp'};
  if(window.failure==='post-pair')return {...result,releaseId:'30000000-0000-4000-8000-000000000001'};
  window.stale[id]=window.stale[id].filter(scene=>scene!==options.body.sourceSceneKey);
  if(window.failure==='source-change')work.activeReleaseId='30000000-0000-4000-8000-000000000001';
  return result;
 }
 if(name==='replacement-status'){
  const value={workId:id,releaseId:work?.activeReleaseId,releaseChecksum:'${checksum}',readyCount:2,
   staleCount:window.stale[id]?.length||0,items:(window.stale[id]||[]).map(sourceSceneKey=>({sourceSceneKey,assetId:''}))};
  if(window.failure==='read-pair')return {...value,releaseId:'30000000-0000-4000-8000-000000000001'};
  return value;
 }
 if(name==='ai-status'){
  if(window.aiFailure==='latest-unknown'&&window.active[id])return {status:'unavailable'};
  return {workId:id,releaseId:work?.activeReleaseId,status:window.active[id]?'active':'inactive',active:window.active[id],
   ...(['monster','rebellion'].includes(work?.key)?{choicePreparation:{...window.progress[id]}}:{})};
 }
 if(name==='choice-coverage'){
  const total=window.progress[id]?.totalParts||2, ready=window.progress[id]?.ready;
  return {workId:id,releaseId:work?.activeReleaseId,status:'ready',totalParts:total,totalScenes:total,partsWithoutScenes:0,
  distribution:{zero:0,one:ready?0:total,two:0,threeValid:ready?total:0,otherOrInvalid:0},routeIssues:{duplicateImmediateTargets:0,invalidDirectTargets:0},incompleteExamples:[]};
 }
 return {status:'unavailable',active:false};
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

async function openFixedPage(browser, site, width) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  page.errors = []; page.on('pageerror', error => page.errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${site.address().port}/`);
  try {
    await page.locator('#storyPublicationState').getByText('0건을 확인했습니다.', { exact: false }).waitFor({ timeout: 5000 });
  } catch (error) {
    throw new Error(`${error.message}\n${JSON.stringify(page.errors)}\n${await page.locator('body').innerText()}`);
  }
  return page;
}

test('all four fixed works use verified image sources and stop ambiguous batches without mobile clipping', { timeout: 180000 }, async () => {
  const site = server(); await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    if (artifacts) await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const open = width => openFixedPage(browser, site, width);
    for (const width of [390, 400, 1280]) for (const work of works) {
      const page = await open(width);
      const card = page.locator(`[data-story-visual-card="${work.key}"]`);
      const button = card.locator('[data-story-visual-replace]:not([data-story-visual-scene])');
      assert.equal(await button.isEnabled(), true);
      assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 0);
      const bounds = await card.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await button.scrollIntoViewIfNeeded();
      assert.equal(await button.evaluate(element => { const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); }), true);
      if (artifacts && work.key === 'norse') await page.screenshot({ path: `${artifacts}/fixed-visual-${width}.png` });
      await page.evaluate(() => { window.holdPost = true; }); await button.click();
      await page.waitForFunction(() => typeof window.resolvePost === 'function');
      assert.equal(await page.locator('#storyPublicationRefreshButton').isDisabled(), true);
      assert.equal(await page.locator('[data-story-ai-card="monster"] [data-story-ai-confirm]').first().isDisabled(), true);
      await page.evaluate(() => { window.holdPost = false; window.resolvePost(); });
      await page.locator('#storyPublicationState').getByText('장면 그림 2장을 새 기준으로 교체했습니다.', { exact: false }).waitFor();
      const actions = await page.evaluate(id => window.requests.filter(x => x.url.includes(`/story-visuals/${id}/`)), work.id);
      assert.deepEqual(actions.map(x => x.method), ['GET', 'POST', 'GET', 'POST', 'GET']);
      const posts = actions.filter(x => x.method === 'POST');
      for (const [index, post] of posts.entries()) assert.deepEqual(post.body, { releaseId: work.activeReleaseId,
        releaseChecksum: checksum, sourceSceneKey: `${work.key}-${index === 0 ? 'one' : 'two'}` });
      assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 2);
      assert.equal(await card.locator('[data-story-visual-replace]').count(), 0);
      assert.deepEqual(page.errors, []); await page.close();
    }
    for (const failure of ['read-pair', 'post-pair', 'uncertain', 'source-change']) {
      const page = await open(390), key = 'monster';
      await page.evaluate(value => { window.failure = value; }, failure);
      const card = page.locator(`[data-story-visual-card="${key}"]`);
      if (failure === 'read-pair') {
        await page.locator('#storyPublicationRefreshButton').click();
        await card.locator('[data-story-visual-status]').getByText('확인하지 못했습니다.', { exact: false }).waitFor();
        assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 0);
      } else {
        await card.locator('[data-story-visual-replace]:not([data-story-visual-scene])').click();
        if (failure === 'source-change') await card.getByText('대상별 확인 필요', { exact: true }).waitFor();
        else await card.locator('[data-story-visual-status]').getByText('추가 교체는 차단했습니다.', { exact: false }).waitFor();
        assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === 'POST'))).length, 1);
      }
      assert.equal(await card.locator('[data-story-visual-replace]').count(), 0);
      assert.deepEqual(page.errors, []); await page.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => site.close(resolve)); }
});

test('fixed AI approvals stay scoped on PC/mobile and staged preparation never silently activates or retries', { timeout: 180000 }, async () => {
  const site = server(); await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    if (artifacts) await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const cardFor = (page, key) => page.locator(`[data-story-ai-card="${key}"]`);
    const confirm = async card => {
      for (const box of await card.locator('[data-story-ai-confirm]').all()) await box.check();
      assert.equal(await card.locator('[data-story-ai-activate]').isEnabled(), true);
    };
    const posts = page => page.evaluate(() => window.requests.filter(item => item.method === 'POST'));
    for (const width of [390, 400, 1280]) for (const work of works) {
      const page = await openFixedPage(browser, site, width);
      try {
        const card = cardFor(page, work.key);
        await confirm(card);
        const button = card.locator('[data-story-ai-activate]'); await button.scrollIntoViewIfNeeded();
        const bounds = await card.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        assert.equal(await button.evaluate(element => { const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); }), true);
        if (artifacts && work.key === 'monster') await page.screenshot({ path: `${artifacts}/fixed-ai-${width}.png` });
        assert.equal((await posts(page)).length, 0);
        await page.evaluate(() => { window.aiHeld = true; }); await button.click();
        await page.waitForFunction(() => typeof window.aiResolve === 'function');
        assert.equal(await page.locator('#storyPublicationRefreshButton').isDisabled(), true);
        assert.equal(await page.locator('[data-story-ai-confirm]:enabled').count(), 0);
        assert.equal(await page.locator('[data-story-visual-replace]:enabled').count(), 0);
        await page.evaluate(() => { window.aiHeld = false; window.aiResolve(); });
        await page.locator('#storyPublicationState').getByText('AI 분기를 활성화했습니다.', { exact: false }).waitFor();
        assert.equal((await posts(page)).length, 1);
        assert.deepEqual((await posts(page))[0].body, { workId: work.id, releaseId: work.activeReleaseId,
          aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true,
          generatedResultReuseConfirmed: true, imageTransformationConfirmed: true });
        await card.getByText('활성', { exact: true }).waitFor();
        assert.equal(await card.locator('[data-story-ai-confirm]:checked').count(), 0);
        assert.equal(await button.isDisabled(), true);
        const queries = await page.evaluate(id => window.requests.filter(item => item.method === 'GET' &&
          /\/(ai-status|choice-coverage)\?/.test(item.url) && item.url.includes(id)).map(item => item.url), work.id);
        assert.equal(queries.length, 4);
        for (const query of queries) {
          const params = new URL(query, 'http://local.test').searchParams;
          assert.equal(params.get('workId'), work.id); assert.equal(params.get('releaseId'), work.activeReleaseId);
        }
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    }

    for (const key of ['monster', 'rebellion']) {
      const page = await openFixedPage(browser, site, 390), work = works.find(item => item.key === key);
      try {
        await page.evaluate(id => { window.progress[id] = {
          totalParts: 18, preparedParts: 0, remainingParts: 18, ready: false, phase: 'preparing',
        }; }, work.id);
        await page.locator('#storyPublicationRefreshButton').click();
        const card = cardFor(page, key);
        await card.getByText('0 / 18파트 선택지 준비', { exact: false }).waitFor();
        for (const [index, progress] of [8, 16, 18].entries()) {
          await confirm(card); await card.locator('[data-story-ai-activate]').click();
          await page.locator('#storyPublicationState').getByText(`${progress} / 18파트 준비.`, { exact: false }).waitFor();
          assert.equal((await posts(page)).length, index + 1);
          assert.equal(await card.locator('[data-story-ai-confirm]:checked').count(), 0);
          await card.getByText('비활성', { exact: true }).waitFor();
        }
        assert.equal(await card.locator('[data-story-ai-activate]').innerText(), '준비된 선택지 적용');
        await confirm(card); await card.locator('[data-story-ai-activate]').click();
        await page.locator('#storyPublicationState').getByText('AI 분기를 활성화했습니다.', { exact: false }).waitFor();
        assert.equal((await posts(page)).length, 4);
        await page.locator(`[data-story-choice-coverage="${key}"]`).getByText('전 장면 3개', { exact: true }).waitFor();
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    }

    for (const failure of ['post-pair', 'post-counts', 'uncertain', 'latest-unknown', 'source-change']) {
      const page = await openFixedPage(browser, site, 400);
      try {
        await page.evaluate(value => { window.aiFailure = value; }, failure);
        const card = cardFor(page, 'monster'); await confirm(card);
        await card.locator('[data-story-ai-activate]').click();
        if (failure === 'source-change') await card.getByText('확인 필요', { exact: true }).waitFor();
        else await card.locator('[data-story-ai-status]').getByText('자동으로 재시도하지 않습니다.', { exact: false }).waitFor();
        assert.equal((await posts(page)).length, 1);
        assert.equal(await card.locator('[data-story-ai-activate]').isDisabled(), true);
        assert.equal(await card.locator('[data-story-ai-confirm]:enabled').count(), 0);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser?.close(); await new Promise(resolve => site.close(resolve)); }
});

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
const bootstrap = `
const A='${A}', B='${B}', releaseA='${releaseA}', releaseB='${releaseB}';
const reverse = new URL(location.href).searchParams.get('reverse') === 'true';
window.testRequests = []; window.testHoldA = false; window.testMismatch = false;
window.testCatalog = [
  {id:A,slug:'the-killer-inherits-the-dead-source-a-old',activeReleaseId:releaseA,status:'published'},
  {id:B,slug:'the-killer-inherits-the-dead-source-b-reviewed-approved',activeReleaseId:releaseB,status:'published'}
]; if (reverse) window.testCatalog.reverse();
window.testPrepared = {};
window.LuminaBackstageApi = { fetch: async (url, options={}) => {
  window.testRequests.push({url,method:options.method || 'GET',body:options.body});
  const path = new URL(url, location.href);
  if (path.pathname.endsWith('/submissions')) return {items:[],publishedWorks:window.testCatalog};
  const workId = path.searchParams.get('workId'), releaseId = path.searchParams.get('releaseId');
  const result = () => ({workId:window.testMismatch ? A : workId, releaseId:window.testMismatch ? releaseA : releaseId,
    slug:window.testCatalog.find(work=>work.id===workId)?.slug,
    status:window.testPrepared[workId]===265 ? 'ready':'preparing_choices',
    preparedParts:window.testPrepared[workId] || (workId===B ? 17:3),totalParts:265,preparationBatch:null,pending:[]});
  if (path.pathname.endsWith('/choice-status')) {
    if (workId===A && window.testHoldA) return new Promise(resolve=>{window.testResolveA=()=>resolve(result());});
    return result();
  }
  if (options.method==='POST' && path.pathname.endsWith('/prepare-choices')) {
    window.testPrepared[options.body.workId]=265;
    return {...options.body,status:'ready',preparedParts:265,totalParts:265,preparationBatch:null,pending:[]};
  }
  if (path.pathname.endsWith('/ai-status')) return {workId,releaseId,status:'inactive',active:false};
  if (path.pathname.endsWith('/choice-coverage')) return {workId,releaseId,status:'ready',totalParts:265,totalScenes:265,
    partsWithoutScenes:0,distribution:{zero:0,one:248,two:0,threeValid:17,otherOrInvalid:0},routeIssues:{duplicateImmediateTargets:0,invalidDirectTargets:0},incompleteExamples:[]};
  if (path.pathname.endsWith('/replacement-status')) {
    const work = window.testCatalog.find(item=>path.pathname.includes(item.id));
    return {workId:work?.id,releaseId:work?.activeReleaseId,releaseChecksum:'a'.repeat(64),readyCount:0,staleCount:0,items:[]};
  }
  return {status:'unavailable',active:false};
}};
`;

function server() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="ko"><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/backstage.css"><link rel="stylesheet" href="/backstage-story-publication.css">
        </head><body><div id="backstageDashboardView"><nav class="sidebar-nav"><a href="#story-publication">스토리 공개</a></nav>
        <main class="dashboard-main" data-active-section="story-publication"><button id="storyPublicationRefreshButton">새로고침</button>
        <div id="storyPublicationStatusCards" class="story-publication-status-grid"></div><div id="storyPublicationSubmissionList"></div>
        <p id="storyPublicationState" role="status"></p></main></div>
        <script>${bootstrap}</script><script src="/backstage-story-publication.js"></script>
        <script>document.querySelector('.sidebar-nav a').click();</script></body></html>`);
    } else if (['/backstage.css','/backstage-story-publication.css','/backstage-story-publication.js'].includes(path)) {
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(await readFile(root + path));
    } else response.writeHead(404).end();
  });
}

test('explicit published source selection fits mobile/PC and never chooses the first list row for generation', { timeout: 120000 }, async () => {
  const site = server(); await new Promise(resolve => site.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    if (artifacts) await mkdir(artifacts,{recursive:true});
    browser = await chromium.launch({headless:true,...(executablePath ? {executablePath}: {})});
    for (const width of [390,400,1280]) for (const reverse of [false,true]) {
      const page = await browser.newPage({viewport:{width,height:850}});
      const errors = []; page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue():route.abort());
      await page.goto(`http://127.0.0.1:${site.address().port}/?reverse=${reverse}`);
      await page.locator('#storyPublicationState').getByText('0건을 확인했습니다.',{exact:false}).waitFor();
      const card=page.locator('[data-story-choice-card]');
      assert.equal(await card.locator('[data-story-choice-target]').inputValue(),'');
      assert.equal(await card.locator('[data-story-prepare-choices]').isDisabled(),true);
      assert.equal((await page.evaluate(()=>window.testRequests.filter(x=>x.url.includes('/choice-status')))).length,0);
      await card.locator('[data-story-choice-target]').selectOption(B);
      await page.waitForFunction(()=>!document.querySelector('[data-story-prepare-choices]').disabled);
      const reads=await page.evaluate(()=>window.testRequests.filter(x=>x.url.includes('/choice-status')));
      assert.ok(reads.length); for (const read of reads) {
        const params=new URL(read.url,'http://localhost').searchParams;
        assert.equal(params.get('workId'),B); assert.equal(params.get('releaseId'),releaseB);
      }
      assert.equal((await page.evaluate(()=>window.testRequests.filter(x=>x.method==='POST'))).length,0);
      const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll('[data-story-choice-card], [data-story-choice-target], .story-choice-target-facts dd, [data-story-prepare-choices]')].map(el=>el.getBoundingClientRect().toJSON())}));
      assert.ok(layout.width<=width,`page overflow ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.boxes.every(box=>box.left>=-1 && box.right<=width+1),`target controls clipped ${width}: ${JSON.stringify(layout)}`);
      if (artifacts && !reverse) await card.screenshot({path:`${artifacts}/choice-target-${width}.png`});
      await card.locator('[data-story-prepare-choices]').click();
      await page.locator('#storyPublicationState').getByText('모든 파트의 선택지 3개가 준비됐습니다.',{exact:false}).waitFor();
      const posts=await page.evaluate(()=>window.testRequests.filter(x=>x.method==='POST'));
      assert.equal(posts.length,1); assert.deepEqual(posts[0].body,{workId:B,releaseId:releaseB});
      assert.match(posts[0].url,/prepare-choices$/); assert.deepEqual(errors,[]);
      await page.close();
    }
    const page=await browser.newPage({viewport:{width:390,height:850}});
    await page.goto(`http://127.0.0.1:${site.address().port}/`);
    await page.locator('#storyPublicationState').getByText('0건을 확인했습니다.',{exact:false}).waitFor();
    const card=page.locator('[data-story-choice-card]');
    await page.evaluate(()=>{window.testHoldA=true;});
    await card.locator('[data-story-choice-target]').selectOption(A);
    await page.waitForFunction(()=>typeof window.testResolveA==='function');
    await card.locator('[data-story-choice-target]').selectOption(B);
    await page.waitForFunction(()=>!document.querySelector('[data-story-prepare-choices]').disabled);
    const before=await card.innerText(); await page.evaluate(()=>window.testResolveA());
    await page.waitForTimeout(20); assert.equal(await card.innerText(),before);
    await page.evaluate(({workId,release})=>{window.testCatalog=window.testCatalog.map(work=>work.id===workId ? {...work,activeReleaseId:release}:work);},{workId:B,release:releaseNew});
    await page.locator('#storyPublicationRefreshButton').click();
    await card.locator('[data-story-choice-target-state]').getByText('변경되었습니다.',{exact:false}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('[data-story-choice-target]').disabled);
    assert.equal(await card.locator('[data-story-choice-target]').inputValue(),'');
    assert.equal(await card.locator('[data-story-prepare-choices]').isDisabled(),true);
    await page.evaluate(()=>{window.testMismatch=true;});
    await card.locator('[data-story-choice-target]').selectOption(B);
    await page.waitForTimeout(40);
    assert.match(await card.locator('[data-story-choice-target-state]').innerText(),/선택한 대상과 다릅니다/);
    assert.equal(await card.locator('[data-story-prepare-choices]').isDisabled(),true);
    assert.equal((await page.evaluate(()=>window.testRequests.filter(x=>x.method==='POST'))).length,0);
    await page.close();
  } finally {await browser?.close(); await new Promise(resolve=>site.close(resolve));}
});

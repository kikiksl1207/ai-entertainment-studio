import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

// Opt in only after the main agent's serial database checks. No server or real provider is used by this fixture.
const enabled = process.env.STORY_BOOKING_BROWSER_QA === '1';
const bundle = 'C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const artifacts = process.env.STORY_BOOKING_ARTIFACTS;
const workId = '10000000-0000-4000-8000-000000000001';
const secondWorkId = '10000000-0000-4000-8000-000000000002';
const releaseId = '20000000-0000-4000-8000-000000000001';
const secondReleaseId = '20000000-0000-4000-8000-000000000002';
const generationId = '30000000-0000-4000-8000-000000000001';
const secondGenerationId = '30000000-0000-4000-8000-000000000002';
const longScene = `scene-${'very-long-scene-key-'.repeat(8)}`.slice(0, 160);
const baseItem = { generationId, sourceSceneKey: longScene, status: 'failed', attemptCount: 0,
  reason: 'changed', canReprepare: true, reviewSha256: 'a'.repeat(64), currentBookingIdentitySha256: 'b'.repeat(64),
  bookedIdentitySha256: 'c'.repeat(64), promptSha256: 'd'.repeat(64) };
const checksum = 'e'.repeat(64);
const catalog = [{ id: workId, activeReleaseId: releaseId, status: 'published',
  slug: `published-${'long-work-slug-'.repeat(12)}`, title: { ko: '예약 기준 검토 작품', en: 'Booking review title' } },
{ id: secondWorkId, activeReleaseId: secondReleaseId, status: 'published', slug: 'second-work' }];
const endpoint = '/admin/api/v1/backstage/story-publication/submissions';
const baseReview = { workId, releaseId, releaseChecksum: checksum, eligible: true,
  items: [baseItem], nextAfterId: null };

function bootstrap() {
  return `
    window.auth={accessToken:'fixture-token',user:{id:'operator-one'}};
    window.getBackstageAuth=()=>window.auth;
    window.catalog=${JSON.stringify(catalog)};
    window.requests=[]; window.review=${JSON.stringify(baseReview)};
    window.failRead=false; window.failPost=false; window.holdRead=false; window.holdPost=false;
    window.LuminaBackstageApi={fetch:async(url,options={})=>{
      window.requests.push({url,method:options.method||'GET',auth:options.auth,body:options.body});
      if(url==='${endpoint}')return {publishedWorks:structuredClone(window.catalog)};
      if(options.method==='POST'){
        if(!url.endsWith('/reprepare-booking'))throw new Error('Unexpected mutation');
        if(window.holdPost)await new Promise(resolve=>{window.releasePost=resolve;});
        if(window.failPost)throw new Error('Uncertain result');
        const body=options.body;
        return {workId:url.split('/')[5],releaseId:body.releaseId,releaseChecksum:body.releaseChecksum,
          generationId:body.generationId,sourceSceneKey:body.sourceSceneKey,status:'pending',
          bookingIdentitySha256:body.expectedCurrentBookingIdentitySha256,generationStarted:false};
      }
      const answer=structuredClone(window.review);
      if(window.holdRead)await new Promise(resolve=>{window.releaseRead=resolve;});
      if(window.failRead)throw new Error('Read failed');
      const address=new URL(url,location.href),id=address.pathname.split('/')[5];
      if(id==='${secondWorkId}')return {...answer,workId:id,releaseId:'${secondReleaseId}'};
      if(window.pagination&&address.searchParams.get('afterId'))return {...answer,
        items:[{...answer.items[0],generationId:'${secondGenerationId}',sourceSceneKey:'scene-next'}],nextAfterId:null};
      if(window.pagination)return {...answer,nextAfterId:'${generationId}'};
      return answer;
    }};
  `;
}

async function fixture(context, width) {
  const source = await readFile(new URL('../backstage-story-visual-booking.js', import.meta.url), 'utf8');
  const bookingCss = await readFile(new URL('../backstage-story-visual-booking.css', import.meta.url), 'utf8');
  const backstageCss = await readFile(new URL('../backstage.css', import.meta.url), 'utf8');
  const publicationCss = await readFile(new URL('../backstage-story-publication.css', import.meta.url), 'utf8');
  const actualEntry = await readFile(new URL('../backstage/index.html', import.meta.url), 'utf8');
  const logo = await readFile(new URL('../assets/brand/lumina-stage-logo.png', import.meta.url));
  const page = await context.newPage();
  const errors = [], traffic = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  // Exercise the real entry, sidebar and main layout, not real authentication or unrelated operations.
  const html = actualEntry.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
    (tag, src) => src === '/backstage-story-visual-booking.js' ? tag : '');
  await page.addInitScript({ content: `${bootstrap()}
    document.addEventListener('DOMContentLoaded',()=>{
      document.body.classList.remove('is-booting');
      document.getElementById('backstageLoginView').classList.add('is-hidden');
      document.getElementById('backstageDashboardView').classList.remove('is-hidden');
      const navigate=(id)=>{
        document.querySelector('.dashboard-main').dataset.activeSection=id;
        document.querySelectorAll('.section-block').forEach(section=>section.classList.toggle('is-active',section.id===id));
        document.querySelectorAll('.sidebar-nav a').forEach(link=>link.classList.toggle('is-active',link.hash==='#'+id));
      };
      document.querySelectorAll('.sidebar-nav a').forEach(link=>link.addEventListener('click',()=>navigate(link.hash.slice(1))));
      document.getElementById('backstageLogoutButton').addEventListener('click',()=>{
        window.auth=null;document.getElementById('backstageDashboardView').classList.add('is-hidden');
      });
      navigate('story-publication');
    });` });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    traffic.push(url.href);
    if (url.origin !== 'http://booking-fixture.invalid') return route.abort();
    const files = { '/backstage/': ['text/html', html], '/backstage.css': ['text/css', backstageCss],
      '/backstage-story-publication.css': ['text/css', publicationCss],
      '/backstage-story-visual-booking.css': ['text/css', bookingCss],
      '/backstage-story-visual-booking.js': ['text/javascript', source],
      '/assets/brand/lumina-stage-logo.png': ['image/png', logo] };
    const file = files[url.pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({ status: 200, contentType: `${file[0]}; charset=utf-8`, body: file[1] });
  });
  await page.goto('http://booking-fixture.invalid/backstage/');
  await page.locator('[data-booking-work]:enabled').waitFor();
  assert.equal(await page.locator('#backstageDashboardView #story-publication #storyVisualBookingPanel').count(), 1);
  assert.ok(await page.locator('[data-booking-work] option').allTextContents().then(labels => labels.some(label => label.includes('예약 기준 검토 작품'))));
  return { page, errors, traffic };
}

const posts = page => page.evaluate(() => window.requests.filter(request => request.method === 'POST'));
const load = async (page, id = workId) => {
  await page.locator('[data-booking-work]').selectOption(id);
  await page.locator('[data-booking-action="load"]').click();
  await page.locator('[data-booking-item]').first().waitFor();
};
const approve = async page => {
  await page.locator('[data-booking-item]').first().check();
  await page.locator('[data-booking-ack]').check();
  await page.locator('[data-booking-action="prepare"]').click();
  await page.locator('dialog[open]').waitFor();
};

async function assertFit(page, width) {
  const failures = await page.locator('#storyVisualBookingPanel').evaluate((host, width) => {
    const failures = [];
    for (const element of [host, ...host.querySelectorAll('button,select,dd,strong,label,p')]) {
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > width + 1) failures.push(`${element.tagName}: outside viewport`);
      if (element.tagName !== 'SELECT' && element.scrollWidth > element.clientWidth + 2) failures.push(`${element.tagName}: text overflow`);
    }
    return failures;
  }, width);
  assert.deepEqual(failures, []);
  const panel = await page.locator('#storyVisualBookingPanel').boundingBox();
  assert.ok(panel.width > 250 && panel.height > 200, 'the panel must have rendered visible content');
}

test('isolated booking browser evidence: desktop/mobile gates, quarantine, errors, navigation and long keys',
  { skip: !enabled, timeout: 240000 }, async () => {
    assert.ok(artifacts && /^E:[\\/]/i.test(path.resolve(artifacts)), 'STORY_BOOKING_ARTIFACTS must name an absolute E: directory');
    const root = path.resolve(artifacts);
    const temp = path.join(root, 'temp');
    await mkdir(temp, { recursive: true });
    const { chromium } = createRequire(import.meta.url)(bundle);
    const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      headless: true, viewport: { width: 1280, height: 900 },
      ...(process.env.STORY_UI_BROWSER ? { executablePath: process.env.STORY_UI_BROWSER } : {}),
      env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
      downloadsPath: path.join(root, 'downloads'), tracesDir: path.join(root, 'traces'),
      args: [`--disk-cache-dir=${path.join(root, 'cache')}`, `--crash-dumps-dir=${path.join(root, 'crashes')}`]
    });
    const evidence = [];
    try {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      for (const width of [390, 400, 1280]) {
        const { page, errors, traffic } = await fixture(context, width);
        try {
          assert.equal((await posts(page)).length, 0);
          await page.locator('[data-booking-work]').selectOption(workId);
          assert.equal(await page.evaluate(() => window.requests.filter(request => request.url.includes('booking-review')).length), 0,
            'work selection must not automatically load a review');
          await page.locator('[data-booking-action="load"]').click();
          await page.locator('[data-booking-item]').waitFor();
          await page.locator('summary').click();
          await assertFit(page, width);
          await page.screenshot({ path: path.join(root, `booking-review-${width}.png`), fullPage: true });
          await page.locator('[data-booking-item]').check();
          assert.equal(await page.locator('[data-booking-action="prepare"]').isDisabled(), true);
          await approve(page);
          await page.locator('dialog').getByText(longScene, { exact: true }).waitFor();
          await page.locator('dialog').getByText('이미 요청/청구된 작업은 다시 시작하지 않습니다.', { exact: false }).waitFor();
          assert.equal((await posts(page)).length, 0);
          await assertFit(page, width);
          await page.screenshot({ path: path.join(root, `booking-confirm-${width}.png`) });
          await page.locator('[data-booking-action="cancel"]').click();
          assert.equal(await page.locator('[data-booking-ack]').isChecked(), false);
          await approve(page);
          await page.evaluate(() => { window.holdPost = true; });
          await page.locator('[data-booking-action="confirm"]').click();
          await page.waitForFunction(() => typeof window.releasePost === 'function');
          assert.equal(await page.locator('dialog[open]').count(), 0);
          assert.equal(await page.locator('[data-booking-ack]').count(), 0);
          assert.equal(await page.locator('[data-booking-work]').isDisabled(), true);
          assert.equal((await posts(page)).length, 1);
          await page.evaluate(() => { window.holdPost = false; window.releasePost(); });
          await page.locator('[role="status"]').getByText('예약을 재준비했습니다.', { exact: false }).waitFor();
          const requests = await posts(page);
          assert.deepEqual(requests[0].body, { generationId, releaseId, releaseChecksum: checksum,
            sourceSceneKey: longScene, promptSha256: baseItem.promptSha256, expectedReviewSha256: baseItem.reviewSha256,
            expectedCurrentBookingIdentitySha256: baseItem.currentBookingIdentitySha256, confirmedResume: true });
          assert.equal(requests[0].auth, true);
          assert.equal(requests.length, 1);
          await assertFit(page, width);
          await page.screenshot({ path: path.join(root, `booking-prepared-${width}.png`), fullPage: true });
          assert.deepEqual(errors, []);
          evidence.push({ scenario: 'explicit single-item preparation', width, requests, traffic, errors });
        } finally { await page.close(); }
      }

      for (const mode of ['read-failure', 'read-crosswork', 'uppercase-hash', 'inconsistent-gate', 'current', 'blocked',
        'post-failure', 'post-auth-change', 'late-work-read', 'catalog-release-change', 'unsupported']) {
        const { page, errors } = await fixture(context, 400);
        try {
          await load(page);
          if (['read-failure', 'read-crosswork', 'uppercase-hash', 'inconsistent-gate'].includes(mode)) {
            await approve(page); await page.keyboard.press('Escape');
            await page.evaluate(mode => {
              if (mode === 'read-failure') window.failRead = true;
              if (mode === 'read-crosswork') window.review.workId = '10000000-0000-4000-8000-000000000002';
              if (mode === 'uppercase-hash') window.review.items[0].reviewSha256 = 'A'.repeat(64);
              if (mode === 'inconsistent-gate') window.review.items[0].status = 'blocked';
            }, mode);
            await page.locator('[data-booking-action="load"]').click();
            await page.locator('.booking-state.is-error').waitFor();
          } else if (mode === 'current' || mode === 'blocked') {
            await page.evaluate(mode => {
              const item=window.review.items[0]; item.reason=mode; item.canReprepare=false;
              item.reviewSha256=null; item.currentBookingIdentitySha256=null;
            }, mode);
            await page.locator('[data-booking-action="load"]').click();
            await page.locator('[data-booking-item]').waitFor();
            await page.locator('[data-booking-item]').check();
            assert.equal(await page.locator('[data-booking-ack]').isDisabled(), true);
          } else if (mode === 'post-failure') {
            await approve(page); await page.evaluate(() => { window.failPost = true; });
            await page.locator('[data-booking-action="confirm"]').click();
            await page.locator('.booking-state.is-error').waitFor();
            assert.equal((await posts(page)).length, 1);
          } else if (mode === 'post-auth-change') {
            await approve(page); await page.evaluate(() => { window.holdPost = true; });
            await page.locator('[data-booking-action="confirm"]').click();
            await page.waitForFunction(() => typeof window.releasePost === 'function');
            await page.evaluate(() => {
              window.auth = { accessToken: 'different-token', user: { id: 'operator-two' } };
              window.dispatchEvent(new Event('storage')); window.releasePost();
            });
            await page.locator('.booking-state').getByText('접속 상태가 변경되었습니다.', { exact: false }).waitFor();
          } else if (mode === 'late-work-read') {
            await page.evaluate(() => { window.holdRead = true; });
            await page.locator('[data-booking-action="load"]').click();
            await page.waitForFunction(() => typeof window.releaseRead === 'function');
            await page.locator('#storyPublicationRefreshButton').click();
            await page.locator('[data-booking-work]:enabled').waitFor();
            await page.locator('[data-booking-work]').selectOption(secondWorkId);
            await page.evaluate(() => { window.holdRead = false; window.releaseRead(); });
            assert.equal(await page.locator('[data-booking-item]').count(), 0);
          } else if (mode === 'catalog-release-change') {
            await approve(page);
            await page.evaluate(() => { window.catalog[0].activeReleaseId = '20000000-0000-4000-8000-000000000009'; });
            await page.locator('[data-booking-action="confirm"]').click();
            await page.locator('.booking-state').getByText('작품 목록이나 공개본이 변경되었습니다.', { exact: false }).waitFor();
          } else {
            await page.evaluate(() => { window.review.eligible = false; window.review.items = []; });
            await page.locator('[data-booking-action="load"]').click();
            await page.locator('.booking-state').getByText('지원 범위가 아닙니다.', { exact: false }).waitFor();
          }
          assert.equal(await page.locator('[data-booking-ack]:enabled').count(), 0);
          assert.equal(await page.locator('[data-booking-action="prepare"]:enabled').count(), 0);
          assert.equal(await page.locator('dialog[open]').count(), 0);
          const requests = await posts(page);
          assert.equal(requests.length, ['post-failure', 'post-auth-change'].includes(mode) ? 1 : 0);
          await page.screenshot({ path: path.join(root, `booking-${mode}-400.png`), fullPage: true });
          assert.deepEqual(errors, []);
          evidence.push({ scenario: mode, width: 400, requests, errors });
        } finally { await page.close(); }
      }

      const { page, errors } = await fixture(context, 390);
      try {
        await page.evaluate(() => { window.pagination = true; });
        await load(page); await approve(page); await page.keyboard.press('Escape');
        await page.locator('[data-booking-action="next"]').click();
        await page.locator(`[data-booking-item="${secondGenerationId}"]`).waitFor();
        assert.equal(await page.locator('[data-booking-ack]').count(), 0);
        await page.locator('[data-booking-action="previous"]').click();
        await page.locator(`[data-booking-item="${generationId}"]`).waitFor();
        await page.locator('[data-booking-item]').check();
        assert.equal(await page.locator('[data-booking-ack]').isChecked(), false);
        assert.equal((await posts(page)).length, 0);
        await assertFit(page, 390);
        await page.screenshot({ path: path.join(root, 'booking-pagination-390.png'), fullPage: true });
        assert.deepEqual(errors, []); evidence.push({ scenario: 'pagination', width: 390, requests: await posts(page), errors });
      } finally { await page.close(); }
      await writeFile(path.join(root, 'booking-evidence.json'), JSON.stringify(evidence, null, 2));
    } finally {
      try { await context.tracing.stop({ path: path.join(root, 'booking-trace.zip') }); }
      finally { await context.close(); }
    }
  });

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.WRITER_BOUNDARY_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-writer-boundaries-20260929';
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const html = await readFile(join(root, 'creator-studio/index.html'), 'utf8');
const script = await readFile(join(root, 'pages/creator-studio.js'), 'utf8');
const verifyCall = script.lastIndexOf('  verify();');
assert.ok(verifyCall > 0);
const qaScript = script.slice(0, verifyCall) +
  '  window.__writerQa = { writerBodyEdited };' + script.slice(verifyCall + '  verify();'.length);
const document = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace('</body>', `<script>window.luminaI18n = { t: key => ({
    'writerManuscript.partNumber': '검토 구간 {number}',
    'writerManuscript.viewPart': '원문 구간 보기',
    'writerManuscript.removePart': '경계 삭제',
    'writerManuscript.partTitle': '파트 제목',
    'writerManuscript.prefaceIncluded': '첫 파트 앞 소개·메모가 독자 본문에 포함됩니다.',
    'writerManuscript.prefaceExcluded': '첫 파트 앞 소개·메모는 원문에 남고 독자 본문에서 제외됩니다.',
    'writerManuscript.localReview': '로컬 미리보기: 검토 구간 {count}개 · {lines}줄 · {bytes}바이트. 아직 서버에 전송되지 않았습니다.'
  })[key] || key };</script><script src="/qa-writer.js"></script></body>`);

function server() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (pathname === '/qa-writer') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(document);
        return;
      }
      if (pathname === '/qa-writer.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(qaScript);
        return;
      }
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': { '.css': 'text/css', '.js': 'text/javascript' }[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('not found'); }
  });
}

async function inspectManuscript({ source, expected, widths, label }) {
  await mkdir(artifacts, { recursive: true });
  const site = server();
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      try {
        await page.goto(`http://127.0.0.1:${site.address().port}/qa-writer`);
        await page.evaluate(() => {
          document.getElementById('studioShell').hidden = false;
          const work = document.getElementById('writerManuscriptWork');
          work.add(new Option('QA work', '11111111-1111-4111-8111-111111111111'));
          work.value = '11111111-1111-4111-8111-111111111111';
          work.disabled = false;
          document.querySelectorAll('.studio-section').forEach(section => {
            section.hidden = section.id !== 'writer-manuscript';
            section.classList.toggle('is-active', section.id === 'writer-manuscript');
          });
          document.getElementById('writer-manuscript').scrollIntoView();
        });
        assert.equal(await page.locator('#writerManuscriptBody').isVisible(), true);
        await page.locator('#writerDraftTitle').scrollIntoViewIfNeeded();
        const draftGeometry = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          title: document.getElementById('writerDraftTitle').getBoundingClientRect().toJSON(),
          create: document.getElementById('writerDraftCreate').getBoundingClientRect().toJSON(),
        }));
        assert.ok(draftGeometry.documentWidth <= width + 1, `draft form overflows at ${width}`);
        for (const key of ['title', 'create']) {
          assert.ok(draftGeometry[key].left >= -1 && draftGeometry[key].right <= width + 1,
            `draft ${key} clipped at ${width}: ${JSON.stringify(draftGeometry)}`);
        }
        await page.screenshot({ path: join(artifacts, `${label}-${width}-draft.png`) });
        await page.evaluate(value => {
          const input = document.getElementById('writerManuscriptBody');
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, source);
        assert.equal(await page.locator('.writer-manuscript-part').count(), expected);
        assert.equal(await page.locator('#writerManuscriptSubmit').isEnabled(), false);
        if (source.startsWith('# Part')) {
          assert.equal(await page.locator('#writerManuscriptPrefaceChoice').isVisible(), false);
        }
        if (await page.locator('#writerManuscriptPrefaceChoice').isVisible()) {
          await page.locator('#writerManuscriptSeparatePreface').check();
          const firstPreview = await page.locator('.writer-manuscript-part-preview').first().innerText();
          assert.match(firstPreview, /(?:Part|외전|제\s*\d)/);
          assert.doesNotMatch(firstPreview, /작품 소개|내 이름을 먹지 않은 괴물/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.locator('#writerManuscriptPrefaceChoice').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(artifacts, `${label}-${width}-preface.png`) });
        }
        const first = page.locator('.writer-manuscript-part').first();
        const last = page.locator('.writer-manuscript-part').last();
        await first.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifacts, `${label}-${width}-first.png`) });
        await last.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifacts, `${label}-${width}-last.png`) });
        await page.locator('#writerManuscriptSubmit').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(artifacts, `${label}-${width}-submit.png`) });
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          button: document.getElementById('writerManuscriptAutoParts').getBoundingClientRect().toJSON(),
          first: document.querySelector('.writer-manuscript-part').getBoundingClientRect().toJSON(),
          last: document.querySelector('.writer-manuscript-part:last-child').getBoundingClientRect().toJSON(),
          submit: document.getElementById('writerManuscriptSubmit').getBoundingClientRect().toJSON(),
          submitOpacity: Number(getComputedStyle(document.getElementById('writerManuscriptSubmit')).opacity),
          mobileNav: document.querySelector('.mobile-tabbar')?.getBoundingClientRect().toJSON() || null,
        }));
        assert.ok(geometry.documentWidth <= width + 1, JSON.stringify(geometry));
        for (const key of ['button', 'first', 'last']) {
          assert.ok(geometry[key].left >= -1 && geometry[key].right <= width + 1,
            `${key} clipped at ${width}: ${JSON.stringify(geometry)}`);
        }
        assert.ok(geometry.submit.left >= -1 && geometry.submit.right <= width + 1,
          `submit clipped at ${width}: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.submitOpacity <= 0.5,
          `disabled submit looks active at ${width}: ${JSON.stringify(geometry)}`);
        if (width < 500 && geometry.mobileNav) {
          assert.ok(geometry.submit.bottom <= geometry.mobileNav.top - 1,
            `submit hidden by mobile navigation: ${JSON.stringify(geometry)}`);
        }
      } finally { await page.close(); }
    }
  } finally {
    await browser.close();
    await new Promise(resolve => site.close(resolve));
  }
}

test('32 suggested manuscript parts stay readable on desktop and mobile', { timeout: 90_000 }, async () => {
  const source = process.env.STORY_QA_MANUSCRIPT_PATH
    ? await readFile(process.env.STORY_QA_MANUSCRIPT_PATH, 'utf8')
    : ['# 작품 소개', '앞부분 설명', ...Array.from({ length: 28 }, (_, index) =>
      `# Part ${String(index + 1).padStart(2, '0')}. 본편 ${index + 1}\n장면 ${index + 1}`),
    ...Array.from({ length: 4 }, (_, index) =>
      `# 외전 ${String(index + 1).padStart(2, '0')}. 외전 ${index + 1}\n다른 장면 ${index + 1}`)].join('\n\n');
  await inspectManuscript({ source, expected: 32, widths: [1280, 390], label: 'writer' });
});

test('a manuscript beginning at Part 01 does not show the preface option', { timeout: 90_000 }, async () => {
  const source = '# Part 01. 첫 장\n본문\n\n# Part 02. 둘째 장\n결말';
  await inspectManuscript({ source, expected: 2, widths: [1280, 390], label: 'writer-no-preface' });
});

test('an approved writer creates a private work and it becomes the upload target on desktop and mobile',
  { timeout: 90_000 }, async () => {
    const workId = '66666666-6666-4666-8666-666666666666';
    await mkdir(artifacts, { recursive: true });
    const site = server();
    await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
      for (const width of [1280, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        try {
          const posts = [];
          await page.route('https://api.lumina-stage.com/**', async route => {
            const request = route.request();
            if (request.method() === 'POST' && request.url().endsWith('/me/creator-studio/stories')) {
              posts.push(request.postDataJSON());
              return route.fulfill({ status: 201, contentType: 'application/json',
                body: JSON.stringify({ workId, status: 'draft' }) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json',
              body: JSON.stringify({ items: [{ workId, slug: 'draft-55555555-5555-4555-8555-555555555555',
                publication: { status: 'draft', published: false }, title: { value: '새 작품' },
                permissions: { createManuscript: true } }], nextCursor: null }) });
          });
          await page.goto(`http://127.0.0.1:${site.address().port}/qa-writer`);
          await page.evaluate(() => {
            localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'qa-token',
              user: { id: '11111111-1111-4111-8111-111111111111' } }));
            document.getElementById('studioShell').hidden = false;
            document.querySelectorAll('.studio-section').forEach(section => {
              section.hidden = section.id !== 'writer-manuscript';
              section.classList.toggle('is-active', section.id === 'writer-manuscript');
            });
          });
          await page.locator('#writerDraftTitle').fill('새 작품');
          await page.locator('#writerDraftCreate').click();
          await page.waitForFunction(id => document.getElementById('writerManuscriptWork').value === id, workId);
          assert.equal(posts.length, 1);
          assert.equal(posts[0].title, '새 작품');
          assert.equal(posts[0].locale, 'ko');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.equal(await page.locator('#writerManuscriptWork').isEnabled(), true);
          assert.equal(await page.locator('#writerDraftMetadata').isVisible(), true);
          await page.locator('#writerDraftMetadata').scrollIntoViewIfNeeded();
          const metadataGeometry = await page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            fields: ['writerMetadataAuthor', 'writerMetadataSummary', 'writerMetadataCover',
              'writerMetadataSave'].map(id => document.getElementById(id).getBoundingClientRect().toJSON()),
          }));
          assert.ok(metadataGeometry.documentWidth <= width + 1, JSON.stringify(metadataGeometry));
          for (const field of metadataGeometry.fields) {
            assert.ok(field.left >= -1 && field.right <= width + 1,
              `metadata field clipped at ${width}: ${JSON.stringify(metadataGeometry)}`);
          }
          await page.locator('#writerDraftMetadata').screenshot({ path: join(artifacts, `writer-metadata-${width}.png`) });
        } finally { await page.close(); }
      }
    } finally {
      await browser.close();
      await new Promise(resolve => site.close(resolve));
    }
  });

test('265-part final manuscript remains usable on desktop and mobile', {
  skip: !process.env.STORY_QA_LONG_MANUSCRIPT_PATH, timeout: 120_000,
}, async () => {
  const source = await readFile(process.env.STORY_QA_LONG_MANUSCRIPT_PATH, 'utf8');
  await inspectManuscript({ source, expected: 265, widths: [1280, 390], label: 'writer-265' });
});

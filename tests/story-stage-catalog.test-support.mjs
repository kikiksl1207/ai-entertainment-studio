import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Registered in the reader suite to share exactly one serial Chrome process.
export function registerCatalogTests({ getBrowser, repo, artifacts, base, api }) {
  const workId = '22222222-2222-4222-8222-222222222222';
  const otherId = '33333333-3333-4333-8333-333333333333';
  const partId = '44444444-4444-4444-8444-444444444444';
  const progressId = '11111111-1111-4111-8111-111111111111';
  const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
  const sentences = {
    ko: '오래된 문을 열고 지나온 길을 돌아본다. ', en: 'Open the old door and look back at the path behind you. ',
    ja: '古い扉を開けて、これまで歩んできた道を振り返る。', 'zh-Hans': '打开旧门，回望走过的路。', 'zh-Hant': '打開舊門，回望走過的路。',
  };
  const cap = { configStatus: 'active', choicePolicy: 'first_public_release', fixedChoices: 3, customChoiceEnabled: false,
    revision: 4, source: 'active_release_capability', resetPolicy: { fullLimit: 1, actLimit: 3 } };
  function access({ free = true, owned = false, auth = true, resume = false } = {}) {
    const accessible = free || owned;
    return { status: owned ? 'entitled' : free ? 'free' : auth ? 'purchase_required' : 'sign_in_required', accessible,
      entitled: accessible, entitlementGranted: owned, pricing: { amountLumina: free ? '0' : '125.5', currencyCode: 'LUMINA', free },
      actions: { primary: !auth ? 'sign_in' : !accessible ? 'purchase' : resume ? 'continue' : 'start', authenticationRequired: !auth,
        canStart: auth && accessible, canContinue: auth && accessible && resume, canPurchase: auth && !accessible,
        canRestart: auth && accessible, canReset: auth && accessible && resume, canViewEndings: false }, endingCount: 0 };
  }
  function detail(locale = 'en', options = {}) {
    const localized = (value) => ({ value, locale, fallback: false });
    return { id: workId, slug: 'private-local-story', title: localized(`QA ${locale} ${sentences[locale]}`),
      summary: localized(sentences[locale].repeat(options.long ? 120 : 3)), cover: { url: '/private-qa-cover.png' },
      access: access({ ...options, auth: false }), releaseCapability: { ...cap }, replay: null, endingRecords: [],
      parts: [{ id: partId, position: 1, seasonKey: 'season-1', title: localized(sentences[locale]), access: access({ ...options, auth: false }) }] };
  }
  function owner(options = {}) {
    return { workId, slug: 'private-local-story', title: { value: 'QA title', locale: 'en', fallback: false }, access: access(options),
      replay: { continue: options.resume === true, checkpoint: options.resume === true, reset: options.resume === true, endingCount: 0 }, aiCapability: { ...cap } };
  }
  function progress(options = {}) {
    return { statusKey: `story.progress.status.${options.resume ? 'ready' : 'noProgress'}`, canResume: options.resume === true,
      storyAccess: { isFree: options.free !== false, entitled: options.free !== false || options.owned === true }, releaseCapability: { ...cap },
      fullResetRemaining: 1, actResetRemaining: 3, canFullReset: options.resume === true, canActReset: options.resume === true };
  }
  function error(status = 500) {
    return { status, body: { error: { code: 'INTERNAL_QA_ERROR', messageKey: 'story.private.internal', message: 'SECRET_DIAGNOSTIC' } } };
  }
  const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
  function gate() {
    let release;
    return { promise: new Promise((resolve) => { release = resolve; }), release: () => release() };
  }
  async function fixture(options = {}) {
    const context = await getBrowser().newContext({ viewport: { width: options.width || 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const requests = [];
    const failures = [];
    let hook = options.hook;
    page.on('pageerror', (e) => failures.push(e.message));
    await context.addInitScript(({ locale, authenticated }) => {
      window.testLocale = locale;
      window.testAuthenticated = authenticated;
      window.luminaI18n = { getLocale: () => window.testLocale };
    }, { locale: options.locale || 'en', authenticated: options.auth !== false });
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin === api && url.pathname.startsWith('/api/v1/')) {
        const r = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method(), body: req.postDataJSON(), headers: req.headers() };
        requests.push(r);
        const response = await hook?.(r);
        if (response?.abort) return route.abort('failed');
        if (response) return route.fulfill({ status: response.status || 200, json: response.body });
        const locale = r.query.locale || options.locale || 'en';
        if (r.method === 'GET' && r.path === '/api/v1/stories') {
          const first = detail(locale, options);
          const second = { ...detail(locale, { ...options, free: false }), id: otherId, slug: 'second-local-story' };
          return route.fulfill({ json: { items: options.empty ? [] : [first, second].map(({ parts, replay, endingRecords, ...card }) => card), nextCursor: null } });
        }
        if (r.method === 'GET' && r.path === '/api/v1/stories/private-local-story') return route.fulfill({ json: detail(locale, options) });
        if (r.method === 'GET' && r.path === '/api/v1/stories/second-local-story') return route.fulfill({ json: { ...detail(locale, options), id: otherId, slug: 'second-local-story' } });
        if (r.method === 'GET' && r.path === `/api/v1/me/stories/${workId}/access`) return route.fulfill({ json: owner(options) });
        if (r.method === 'GET' && r.path === `/api/v1/me/stories/${workId}/progress-state`) return route.fulfill({ json: progress(options) });
        if (r.method === 'POST' && r.path === `/api/v1/stories/${workId}/progress`) return route.fulfill({ json: { progressId, revision: 6, choices: [] } });
        if (r.method === 'GET' && r.path === `/api/v1/story-sessions/${progressId}/current-scene`) return route.fulfill({ json: {
          progressId, revision: 6, status: 'completed', scene: null, choices: [], releaseCapability: cap, currentAct: 1,
        } });
        failures.push(`Unexpected API request ${r.method} ${r.path}`);
        return route.abort('blockedbyclient');
      }
      if (url.origin === base && req.method() === 'GET') {
        const files = { '/story-stage': ['story-stage/index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'],
          '/styles/story-stage.css': ['styles/story-stage.css', 'text/css'], '/pages/story-stage.js': ['pages/story-stage.js', 'text/javascript'],
          '/private-qa-cover.png': ['assets/brand/lumina-stage-logo.png', 'image/png'] };
        const file = files[url.pathname];
        if (file) return route.fulfill({ body: await readFile(path.join(repo, file[0])), contentType: file[1] });
        if (url.pathname === '/app.js') {
          const app = await readFile(path.join(repo, 'app.js'), 'utf8');
          const start = app.indexOf('async function apiFetch(');
          const end = app.indexOf('\n/*', start);
          assert.ok(start > 0 && end > start);
          return route.fulfill({ contentType: 'text/javascript', body: `
            document.body.classList.remove('is-booting'); const API_BASE = ${JSON.stringify(api)};
            function isLoggedIn() { return window.testAuthenticated; }
            function getAccessToken() { return window.testAuthenticated ? 'private-synthetic-token' : null; }
            async function refreshAuthOnce() { window.testRefreshCount = (window.testRefreshCount || 0) + 1; return false; }
            ${app.slice(start, end)}
            window.apiFetch = apiFetch;
          ` });
        }
        if (url.pathname === '/data/characters.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      }
      return route.abort('blockedbyclient');
    });
    await page.goto(`${base}/story-stage${options.deep ? '?slug=private-local-story' : ''}`);
    return { page, requests, setHook: (next) => { hook = next; },
      async open() {
        if (!options.deep) await page.locator('[data-pack-slug="private-local-story"]').click();
        await page.locator('[data-story-detail-retry]').waitFor();
      },
      async close() { await context.close(); assert.deepEqual(failures, []); },
    };
  }

  for (const scenario of [
    { name: 'anonymous free', auth: false }, { name: 'anonymous paid', auth: false, free: false },
    { name: 'free start' }, { name: 'free continue', resume: true }, { name: 'owned paid', free: false, owned: true, resume: true },
    { name: 'paid purchase required', free: false }, { name: 'expired ownership', free: false }, { name: 'revoked ownership', free: false },
  ]) {
    test(`catalog: actual DTO + shared apiFetch ${scenario.name}`, async () => {
      const f = await fixture(scenario);
      try {
        await f.open();
        const canRead = scenario.auth !== false && (scenario.free !== false || scenario.owned);
        assert.equal(await f.page.locator('[data-story-start]').count(), canRead ? 1 : 0);
        assert.equal(await f.page.locator('[data-story-catalog-view]').count(), 1);
        assert.equal(await f.page.locator('.story-pack-copy small').count(), 0, 'No fabricated part counts');
        assert.equal(await f.page.locator('.story-detail-modal .story-chapters li').count(), 1);
        assert.equal(await f.page.locator('a[href*="checkout"], a[href*="charge"], [data-story-resume]').count(), 0);
        for (const r of f.requests.filter((r) => r.path.startsWith('/api/v1/stories'))) assert.equal(r.headers.authorization, undefined, 'public GET has no authentication');
        const reads = f.requests.filter((r) => r.path.endsWith('/access'));
        assert.equal(reads.length, scenario.auth === false ? 0 : 1);
        if (reads[0]) assert.equal(reads[0].headers.authorization, 'Bearer private-synthetic-token');
        if (canRead) {
          await f.page.locator('[data-story-start]').click();
          await f.page.waitForURL(`**sessionId=${progressId}&workId=${workId}`);
          const posts = f.requests.filter((r) => r.method === 'POST');
          assert.equal(posts.length, 1);
          assert.equal(posts[0].path, `/api/v1/stories/${workId}/progress`);
          assert.deepEqual(posts[0].body, { mode: 'continue', locale: 'en' });
        } else {
          assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
          assert.equal(await f.page.locator('.story-detail-actions button:disabled').count(), scenario.auth === false ? 0 : 1);
          assert.ok((await f.page.locator('[data-story-detail-status]').innerText()).length > 0);
        }
      } finally { await f.close(); }
    });
  }

  for (const phase of ['detail', 'access', 'progress-state']) {
    for (const status of [401, 403, 404, 500]) {
      test(`catalog: ${phase} ${status} fails closed, explicit retry restores`, async () => {
        const f = await fixture({ hook: (r) => (phase === 'detail' ? r.path === '/api/v1/stories/private-local-story' : r.path.endsWith(`/${phase}`)) ? error(status) : null });
        try {
          await f.open();
          assert.equal(await f.page.locator('[data-story-start]').count(), 0);
          assert.equal(await f.page.locator('.story-detail-modal .story-chapters').count(), phase === 'detail' ? 0 : 1);
          assert.doesNotMatch(await f.page.locator('.story-detail-modal').innerText(), /INTERNAL_|SECRET_|story\.private/);
          if (phase === 'detail') assert.equal(await f.page.evaluate(() => window.testRefreshCount || 0), 0);
          f.setHook(null);
          await f.page.locator('[data-story-detail-retry]').click();
          await f.page.locator('[data-story-start]').waitFor();
          assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
        } finally { await f.close(); }
      });
    }
  }

  for (const [name, mutateOwner, mutateProgress, mutateDetail] of [
    ['missing access', (x) => { delete x.access; }],
    ['legacy entitlement only', (x) => { x.access = { entitled: true, purchaseAction: null }; }],
    ['foreign work', (x) => { x.workId = otherId; }],
    ['unknown price', (x) => { x.access.pricing = null; }],
    ['missing owner release', (x) => { delete x.aiCapability; }],
    ['legacy custom true', (x) => { x.aiCapability.customChoiceEnabled = true; }],
    ['release revision race', (x) => { x.aiCapability.revision = 9; }],
    ['missing progress state', null, () => null],
    ['version mismatch', null, (x) => ({ ...x, statusKey: 'story.progress.status.versionMismatch', canResume: false })],
    ['completed existing progress', null, (x) => ({ ...x, statusKey: 'story.progress.status.completed', canResume: false })],
    ['missing detail capability', null, null, (x) => { delete x.releaseCapability; }],
    ['malformed detail parts', null, null, (x) => { delete x.parts; }],
    ['no published parts', null, null, (x) => { x.parts = []; }],
  ]) {
    test(`catalog: ${name} never enables legacy or guessed start`, async () => {
      const f = await fixture({ hook: (r) => {
        if (r.path.endsWith('/access')) { const x = owner(); mutateOwner?.(x); return { body: x }; }
        if (r.path.endsWith('/progress-state')) { const x = progress(); return { body: mutateProgress ? mutateProgress(x) : x }; }
        if (r.path === '/api/v1/stories/private-local-story') { const x = detail(); mutateDetail?.(x); return { body: x }; }
      } });
      try {
        await f.open();
        assert.equal(await f.page.locator('[data-story-start]').count(), 0);
        await f.page.evaluate(() => {
          const b = document.createElement('button'); b.dataset.storyStart = '';
          document.querySelector('dialog').append(b); b.click(); b.remove();
        });
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
      } finally { await f.close(); }
    });
  }

  test('catalog: list failure is not empty success; deep link works independently', async () => {
    const f = await fixture({ deep: true, hook: (r) => r.path === '/api/v1/stories' ? error() : null });
    try {
      await f.open();
      await f.page.locator('[data-story-start]').waitFor();
      assert.equal(await f.page.locator('[data-story-catalog-view] [data-story-retry]').count(), 1);
      await f.page.locator('[data-story-close]').click();
      assert.equal(new URL(f.page.url()).search, '');
      assert.equal(await f.page.locator('dialog').count(), 0);
      assert.equal(await f.page.locator('#storyStageTitle').evaluate((el) => el === document.activeElement), true);
      f.setHook(null);
      await f.page.locator('[data-story-retry]').click();
      await f.page.locator('[data-pack-slug]').first().waitFor();
    } finally { await f.close(); }
  });

  test('catalog: actual empty collection renders no synthetic cards', async () => {
    const f = await fixture({ empty: true });
    try {
      await f.page.locator('.story-state h2').waitFor();
      await f.page.waitForFunction(() => document.querySelector('[data-story-filter]'));
      assert.equal(await f.page.locator('[data-pack-slug], dialog').count(), 0);
      assert.match(await f.page.locator('[data-story-catalog-view]').innerText(), /No stories are published/);
    } finally { await f.close(); }
  });

  test('catalog: filter, DOM, scroll, focus, back and forward are preserved', async () => {
    const f = await fixture();
    try {
      await f.page.locator('[data-story-filter]').selectOption('free');
      assert.equal(await f.page.locator('[data-pack-slug]').count(), 1);
      await f.page.evaluate(() => {
        window.catalogNode = document.querySelector('[data-story-catalog-view]'); window.scrollTo({ top: 160, behavior: 'instant' });
        document.querySelector('[data-pack-slug]').focus({ preventScroll: true });
      });
      const scroll = await f.page.evaluate(() => window.scrollY);
      // Keyboard activation does not ask Playwright to auto-scroll a tall card into view.
      await f.page.keyboard.press('Enter');
      await f.page.locator('[data-story-start]').waitFor();
      await f.page.keyboard.press('Escape');
      await f.page.waitForURL(`${base}/story-stage`);
      assert.equal(await f.page.locator('[data-story-filter]').inputValue(), 'free');
      assert.equal(await f.page.evaluate(() => window.catalogNode === document.querySelector('[data-story-catalog-view]')), true);
      const restoredScroll = await f.page.evaluate(() => window.scrollY);
      assert.ok(Math.abs(restoredScroll - scroll) <= 2, `scroll ${scroll} -> ${restoredScroll}`);
      assert.equal(await f.page.locator('[data-pack-slug]').evaluate((el) => el === document.activeElement), true);
      await f.page.goForward();
      await f.page.locator('[data-story-start]').waitFor();
      await f.page.goBack();
      await f.page.waitForFunction(() => !document.querySelector('dialog'));
      assert.equal(f.requests.filter((r) => r.path === '/api/v1/stories').length, 1);
    } finally { await f.close(); }
  });

  test('catalog: pagination uses only actual cursor/limit, duplicate clicks and retry', async () => {
    let failed = true;
    const f = await fixture({ hook: (r) => {
      if (r.path !== '/api/v1/stories') return null;
      if (r.query.cursor && failed) return error();
      return { body: { items: [{ ...detail(), id: r.query.cursor ? otherId : workId, slug: r.query.cursor ? 'second-local-story' : 'private-local-story' }], nextCursor: r.query.cursor ? null : workId } };
    } });
    try {
      await f.page.locator('[data-story-more]').click();
      await f.page.waitForFunction(() => document.querySelector('[data-story-more]')?.textContent.includes('Try again'));
      failed = false;
      await f.page.locator('[data-story-more]').click();
      await f.page.waitForFunction(() => document.querySelectorAll('[data-pack-slug]').length === 2);
      assert.deepEqual(f.requests.filter((r) => r.path === '/api/v1/stories').map((r) => r.query), [
        { locale: 'en', limit: '12' }, { locale: 'en', limit: '12', cursor: workId }, { locale: 'en', limit: '12', cursor: workId },
      ]);
      assert.equal(await f.page.locator('[data-story-more]').count(), 0);
    } finally { await f.close(); }
  });

  for (const phase of ['detail', 'access']) {
    test(`catalog: stale ${phase} after close and reopen cannot overwrite new dialog`, async () => {
      const g = gate();
      let seen = false;
      const f = await fixture({ hook: async (r) => {
        if (!seen && (phase === 'detail' ? r.path === '/api/v1/stories/private-local-story' : r.path.endsWith('/access'))) {
          seen = true; await g.promise; return { body: phase === 'detail' ? { ...detail(), title: { value: 'STALE TITLE' } } : { ...owner(), workId: otherId } };
        }
      } });
      try {
        await f.page.locator('[data-pack-slug="private-local-story"]').click();
        while (!seen) await delay(10);
        await f.page.locator('[data-story-close]').click();
        await f.page.waitForURL(`${base}/story-stage`);
        await f.open();
        g.release(); await delay();
        assert.doesNotMatch(await f.page.locator('dialog').innerText(), /STALE TITLE/);
        assert.equal(await f.page.locator('[data-story-start]').count(), 1);
      } finally { g.release(); await f.close(); }
    });
  }

  for (const response of ['lost', 'invalid id', 'missing revision']) {
    test(`catalog: ${response} start response never navigates or auto-replays`, async () => {
      const g = gate();
      const f = await fixture({ hook: async (r) => {
        if (r.method !== 'POST') return null;
        await g.promise;
        return response === 'lost' ? { abort: true } : { body: { progressId: response === 'invalid id' ? 'guessed-id' : progressId, choices: [], ...(response === 'invalid id' ? { revision: 2 } : {}) } };
      } });
      try {
        await f.open();
        await f.page.locator('[data-story-start]').click();
        await f.page.locator('[data-story-start]').dispatchEvent('click');
        g.release();
        await f.page.waitForFunction(() => !document.querySelector('[data-story-start]'));
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
        assert.equal(new URL(f.page.url()).searchParams.get('sessionId'), null);
        assert.match(await f.page.locator('[data-story-detail-status]').innerText(), /cannot be started/);
      } finally { g.release(); await f.close(); }
    });
  }

  for (const change of ['close', 'locale', 'auth']) {
    test(`catalog: pending start + ${change} never navigates on stale completion`, async () => {
      const g = gate();
      const f = await fixture({ hook: async (r) => { if (r.method === 'POST') await g.promise; } });
      try {
        await f.open();
        await f.page.locator('[data-story-start]').click();
        if (change === 'close') {
          await f.page.locator('[data-story-close]').click();
          await f.page.waitForURL(`${base}/story-stage`);
          await f.open();
          assert.equal(await f.page.locator('[data-story-start]').isDisabled(), true);
        } else if (change === 'locale') {
          await f.page.evaluate(() => { window.testLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
          await f.page.waitForFunction(() => document.querySelector('#storyDetailTitle')?.textContent.includes('QA ja'));
        } else {
          await f.page.evaluate(() => { window.testAuthenticated = false; window.dispatchEvent(new Event('lumina:auth-expired')); });
        }
        g.release(); await delay(100);
        assert.equal(new URL(f.page.url()).searchParams.get('sessionId'), null);
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
      } finally { g.release(); await f.close(); }
    });
  }

  test('catalog: old locale detail cannot replace newest locale', async () => {
    const g = gate();
    const f = await fixture({ hook: async (r) => {
      if (r.path === '/api/v1/stories/private-local-story' && r.query.locale === 'ja') { await g.promise; return { body: detail('ja') }; }
    } });
    try {
      await f.open();
      for (const locale of ['ja', 'zh-Hant']) await f.page.evaluate((locale) => { window.testLocale = locale; window.dispatchEvent(new Event('lumina:localechange')); }, locale);
      await f.page.waitForFunction(() => document.querySelector('#storyDetailTitle')?.textContent.includes('QA zh-Hant'));
      g.release(); await delay();
      assert.match(await f.page.locator('#storyDetailTitle').innerText(), /QA zh-Hant/);
    } finally { g.release(); await f.close(); }
  });

  for (const locale of locales) for (const width of [390, 400, 1280]) {
    test(`catalog: ${locale} ${width} contained long detail, focus trap and actual button hit tests`, async () => {
      const f = await fixture({ locale, width, long: true });
      try {
        await f.open();
        await f.page.locator('[data-story-start]').waitFor();
        const dialog = f.page.locator('dialog');
        assert.equal(await f.page.locator('[data-story-close]').evaluate((el) => el === document.activeElement), true);
        await f.page.keyboard.press('Shift+Tab');
        assert.equal(await f.page.locator('[data-story-detail-retry]').evaluate((el) => el === document.activeElement), true);
        await f.page.keyboard.press('Tab');
        assert.equal(await f.page.locator('[data-story-close]').evaluate((el) => el === document.activeElement), true);
        for (const selector of ['[data-story-start]', '[data-story-detail-retry]', '[data-story-close]']) {
          const hit = await f.page.locator(selector).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          });
          assert.equal(hit, true, selector);
        }
        assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        assert.equal(await f.page.locator('.story-detail-body').evaluate((el) => el.scrollHeight > el.clientHeight), true);
        assert.equal(await dialog.locator('img').evaluate((el) => el.complete && el.naturalWidth > 0), true);
        assert.doesNotMatch(await dialog.innerText(), /working copy|developer|INTERNAL_|story\.progress\.|AI choice available/);
        if (process.env.STORY_UI_DETAIL_CAPTURES !== '0') await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-detail.png`) });
        await f.page.locator('.story-detail-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        assert.equal(await f.page.locator('[data-story-start]').evaluate((el) => {
          const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }), true);
      } finally { await f.close(); }
    });
  }
}

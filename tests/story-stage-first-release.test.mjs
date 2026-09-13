import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STORY_UI_PLAYWRIGHT || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const artifacts = process.env.STORY_UI_ARTIFACTS;
assert.match(artifacts || '', /^E:[/\\]/i, 'Artifacts must stay on E:');
assert.match(process.env.TEMP || '', /^E:[/\\]/i, 'Browser profiles must stay on E:');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const sessionId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const base = 'http://127.0.0.1:18700';
const api = 'https://api.lumina-stage.com';
let browser;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.STORY_UI_BROWSER,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
});
after(async () => { await browser?.close(); });

const copy = {
  ko: '문 앞에서 기다리며 멀리서 들려오는 발소리에 귀를 기울인다. ',
  en: 'Wait by the door and listen carefully to the footsteps approaching from the distant courtyard. ',
  ja: '扉の前で待ちながら、遠くの庭から近づいてくる足音に静かに耳を傾ける。',
  'zh-Hans': '在门前静静等待，仔细倾听从远处庭院逐渐靠近的脚步声。',
  'zh-Hant': '在門前靜靜等待，仔細聆聽從遠處庭院逐漸靠近的腳步聲。',
};

function projection(count = 3, locale = 'en', paid = false) {
  return {
    progressId: sessionId, status: count ? 'active' : 'completed', revision: 3,
    storyVersion: 1, currentAct: 2, currentBeatPosition: 0,
    releaseCapability: { choicePolicy: 'first_public_release', fixedChoices: 3, customChoiceEnabled: false },
    scene: {
      id: 'scene-a', endingType: count ? null : 'normal',
      beats: [{ position: 0, content: copy[locale].repeat(3) }],
      // Deliberately contradictory legacy data must never override release policy.
      customChoiceCapability: { enabled: true, entitled: true, maxChars: 2000, submitPath: `/api/v1/me/story-progress/${sessionId}/custom-choice` },
      customChoiceEnabled: true, pricingMode: paid ? 'paid' : 'free',
    },
    choices: Array.from({ length: count }, (_, i) => ({ id: `choice-${i}`, label: `${i + 1} ${copy[locale]}`, targetSceneId: `distinct-route-${i}`, routeKind: i ? 'branch' : 'original' })),
  };
}

function envelope(code, status = 409) {
  return { status, body: { success: false, error: { code, statusCode: status, messageKey: 'story.progress.error.suggestedChoiceLimitExceeded', message: 'INTERNAL_DIAGNOSTIC_DO_NOT_RENDER', details: { retryable: false } } } };
}

async function fixture(options = {}) {
  const locale = options.locale || 'en';
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, serviceWorkers: 'block' });
  const requests = [];
  const errors = [];
  let current = options.current || projection(3, locale);
  let quota = { full: 1, act: 3 };
  let hook = options.hook;
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(({ locale }) => {
    window.testLocale = locale;
    window.luminaI18n = { getLocale: () => window.testLocale };
  }, { locale });
  // No route ever calls continue/fallback: all transport is synthetic or denied.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === api && url.pathname.startsWith('/api/v1/')) {
      const entry = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: request.method(), body: request.postDataJSON(), headers: request.headers() };
      requests.push(entry);
      const custom = await hook?.(entry, { current, quota });
      if (custom) {
        if (custom.abort) return route.abort('failed');
        return route.fulfill({ status: custom.status || 200, json: custom.body });
      }
      if (entry.method === 'GET' && url.pathname.endsWith('/current-scene')) return route.fulfill({ json: current });
      if (entry.method === 'GET' && url.pathname.endsWith('/progress-state')) return route.fulfill({ json: {
        canFullReset: quota.full > 0, canActReset: quota.act > 0,
        fullResetRemaining: quota.full, actResetRemaining: quota.act,
        customChoiceCapability: false, releaseCapability: current.releaseCapability,
      } });
      if (entry.method === 'GET' && url.pathname.endsWith('/reset-preview')) {
        const target = url.searchParams.get('target');
        assert.ok(['full', 'act'].includes(target));
        if (target === 'act') assert.equal(entry.query.actNumber, String(current.currentAct));
        return route.fulfill({ json: { target, targetAct: target === 'full' ? 1 : current.currentAct,
          targetSceneId: 'scene-reset', invalidatedEventCount: 2, remainingBefore: quota[target], remainingAfter: Math.max(0, quota[target] - 1), canExecute: quota[target] > 0, expectedRevision: current.revision } });
      }
      if (entry.method === 'POST' && /\/choices\/choice-[012]$/.test(url.pathname)) {
        assert.deepEqual(entry.body, { expectedRevision: current.revision });
        const choice = current.choices.find((item) => url.pathname.endsWith(`/${item.id}`));
        current = { ...current, revision: current.revision + 1, scene: { ...current.scene, id: choice.targetSceneId, beats: [{ position: 0, content: choice.targetSceneId }] } };
        return route.fulfill({ json: current });
      }
      if (entry.method === 'POST' && url.pathname.endsWith('/reset')) {
        assert.equal(entry.body.expectedRevision, current.revision);
        assert.match(entry.headers['idempotency-key'], /^story-reset-.{8,}$/);
        const target = entry.body.target;
        if (target === 'act') assert.equal(entry.body.actNumber, current.currentAct);
        const beforeRevision = current.revision;
        current = { ...projection(3, locale), revision: beforeRevision + 1, storyVersion: 2, currentAct: target === 'full' ? 1 : current.currentAct,
          releaseCapability: { choicePolicy: 'first_public_release', fixedChoices: 3, customChoiceEnabled: false, source: 'new-release' } };
        quota[target]--;
        return route.fulfill({ json: { target, beforeRevision, afterRevision: current.revision, status: 'completed', idempotentReplay: false } });
      }
      errors.push(`Unexpected synthetic request: ${entry.method} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin === base && request.method() === 'GET') {
      const allowed = {
        '/story-stage': ['story-stage/index.html', 'text/html'],
        '/styles.css': ['styles.css', 'text/css'],
        '/styles/story-stage.css': ['styles/story-stage.css', 'text/css'],
        '/pages/story-stage.js': ['pages/story-stage.js', 'application/javascript'],
      }[url.pathname];
      if (allowed) return route.fulfill({ body: await readFile(path.join(repo, allowed[0])), contentType: allowed[1] });
      if (url.pathname === '/app.js') {
        let body = 'document.body.classList.remove("is-booting");';
        if (options.apiHelper) {
          const app = await readFile(path.join(repo, 'app.js'), 'utf8');
          const start = app.indexOf('async function apiFetch(');
          const end = app.indexOf('\n/*', start);
          body += `const API_BASE = ${JSON.stringify(api)}; function getAccessToken() { return null; } async function refreshAuthOnce() { return false; } ${app.slice(start, end)}; window.apiFetch = apiFetch;`;
        }
        return route.fulfill({ contentType: 'application/javascript', body });
      }
      if (url.pathname === '/data/characters.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(`${base}/story-stage?sessionId=${sessionId}${options.work ? `&workId=${workId}` : ''}`);
  return {
    page, requests, errors,
    setCurrent(value) { current = value; },
    setHook(value) { hook = value; },
    async ready() { await page.locator('.story-player, .story-state h2').first().waitFor(); },
    async close() { await context.close(); assert.deepEqual(errors, []); },
  };
}

for (const locale of locales) {
  for (const paid of [false, true]) {
    for (const count of [0, 1, 2, 3]) {
      test(`${locale} ${paid ? 'paid' : 'free'}: ${count} authored choices, legacy custom disabled`, async () => {
        const f = await fixture({ locale, current: projection(count, locale, paid) });
        try {
          await f.ready();
          assert.equal(await f.page.locator('[data-choice-id]').count(), count);
          assert.equal(await f.page.locator('[data-story-custom-choice], textarea').count(), 0);
          assert.equal(await f.page.locator('.story-ending-label').count(), count ? 0 : 1);
          await f.page.evaluate(() => {
            const form = document.createElement('form');
            form.dataset.storyCustomForm = '';
            form.innerHTML = '<input name="customChoice" value="synthetic attempt">';
            document.querySelector('#storyStageRoot').append(form);
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.remove();
          });
          assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
          assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /story\.progress\.|INTERNAL_DIAGNOSTIC/);
        } finally { await f.close(); }
      });
    }
  }
}

for (const count of [4, 7]) {
  test(`overfull ${count} blocks the whole scene, never truncates`, async () => {
    const f = await fixture({ current: projection(count) });
    try {
      await f.ready();
      assert.equal(await f.page.locator('[data-choice-id], [data-story-retry], .story-player').count(), 0);
      assert.equal(f.requests.length, 1);
    } finally { await f.close(); }
  });
}

for (const index of [0, 1, 2]) {
  test(`choice ${index}: actual handler preserves authored target and disables duplicate submission`, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const f = await fixture({ hook: async (r) => { if (r.method === 'POST') await gate; } });
    try {
      await f.ready();
      await f.page.locator(`[data-choice-id="choice-${index}"]`).click();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'true');
      assert.equal(await f.page.locator('[data-choice-id]:disabled').count(), 3);
      await f.page.locator(`[data-choice-id="choice-${index}"]`).dispatchEvent('click');
      release();
      await f.page.waitForFunction((target) => document.querySelector('[data-story-scene-focus]')?.textContent.includes(target), `distinct-route-${index}`);
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
      assert.equal(await f.page.locator('[data-story-scene-focus]').evaluate((el) => el === document.activeElement), true);
    } finally { release(); await f.close(); }
  });
}

for (const target of ['full', 'act']) {
  test(`${target} reset: preview, focus, exact DTO, quota refresh, next choice revision`, async () => {
    const f = await fixture({ work: true });
    try {
      await f.ready();
      await f.page.locator(`[data-story-reset-preview="${target}"]`).click();
      await f.page.locator('[role="dialog"]').waitFor();
      assert.equal(await f.page.locator('[data-story-reset-cancel]').evaluate((el) => el === document.activeElement), true);
      await f.page.keyboard.press('Shift+Tab');
      assert.equal(await f.page.locator('[data-story-reset-confirm]').evaluate((el) => el === document.activeElement), true);
      await f.page.keyboard.press('Tab');
      await f.page.keyboard.press('Escape');
      assert.equal(await f.page.locator(`[data-story-reset-preview="${target}"]`).evaluate((el) => el === document.activeElement), true);
      await f.page.locator(`[data-story-reset-preview="${target}"]`).click();
      await f.page.locator('[data-story-reset-confirm]').click();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false' && !document.querySelector('[role="dialog"]'));
      assert.match(await f.page.locator(`[data-story-reset-preview="${target}"]`).innerText(), target === 'full' ? /0$/ : /2$/);
      const reset = f.requests.find((r) => r.path.endsWith('/reset'));
      assert.deepEqual(reset.body, { target, ...(target === 'act' ? { actNumber: 2 } : {}), expectedRevision: 3, locale: 'en' });
      assert.ok(f.requests.every((r) => !('afterRevision' in r.query)));
      await f.page.locator('[data-choice-id="choice-1"]').click();
      await f.page.waitForFunction(() => document.querySelector('[data-story-scene-focus]')?.textContent.includes('distinct-route-1'));
      assert.equal(f.requests.find((r) => r.path.includes('/choices/')).body.expectedRevision, 4);
    } finally { await f.close(); }
  });
}

test('stale choice envelope refetches revision without replay or diagnostics', async () => {
  const f = await fixture({ hook: (r) => r.method === 'POST' ? envelope('STORY_PROGRESS_STALE_REVISION') : null });
  try {
    await f.ready();
    f.setCurrent({ ...projection(), revision: 8 });
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-action-status]')?.textContent.includes('progress has changed'));
    assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
    f.setHook(null);
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-scene-focus]')?.textContent.includes('distinct-route-0'));
    assert.equal(f.requests.filter((r) => r.method === 'POST')[1].body.expectedRevision, 8);
  } finally { await f.close(); }
});

for (const [code, status] of [['STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED', 409], ['FORBIDDEN', 403], ['UNAUTHORIZED', 401]]) {
  test(`${code}: error envelope blocks actionable scene with safe copy`, async () => {
    const f = await fixture({ hook: (r) => r.method === 'POST' ? envelope(code, status) : null });
    try {
      await f.ready();
      await f.page.locator('[data-choice-id]').first().click();
      await f.page.locator('.story-state h2').waitFor();
      assert.equal(await f.page.locator('[data-choice-id], [data-story-retry]').count(), 0);
      assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /STORY_|INTERNAL_|story\.progress\./);
    } finally { await f.close(); }
  });
}

test('completed projection without a scene renders ending, not load failure', async () => {
  const f = await fixture({ current: { ...projection(0), scene: null } });
  try { await f.ready(); assert.equal(await f.page.locator('.story-ending-label').count(), 1); }
  finally { await f.close(); }
});

test('reset receipt minimum revision rejects stale refetch and does not replay reset', async () => {
  const f = await fixture({ work: true, hook: (r) => r.path.endsWith('/reset') ? { body: { afterRevision: 5, idempotentReplay: true } } : null });
  try {
    await f.ready();
    await f.page.locator('[data-story-reset-preview="full"]').click();
    await f.page.locator('[data-story-reset-confirm]').click();
    await f.page.locator('[data-story-retry]').waitFor();
    assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
    f.setCurrent({ ...projection(), revision: 7 });
    await f.page.locator('[data-story-retry]').click();
    await f.page.locator('[data-choice-id]').first().waitFor();
    assert.equal(f.requests.filter((r) => r.path.endsWith('/reset')).length, 1);
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-scene-focus]')?.textContent.includes('distinct-route-0'));
    assert.equal(f.requests.find((r) => r.path.includes('/choices/')).body.expectedRevision, 7);
  } finally { await f.close(); }
});

for (const locale of locales) {
  for (const width of [390, 400, 1280]) {
    test(`${locale} ${width}px: long copy, reset dialog, focus and no overflow`, async () => {
      const f = await fixture({ locale, width, current: projection(3, locale) });
      try {
        await f.ready();
        await f.page.evaluate(() => {
          document.querySelector('.story-player-copy p').textContent += ' LongUnbrokenChoiceText'.repeat(35);
          document.querySelector('[data-choice-id]').append('LongUnbrokenChoiceText'.repeat(12));
        });
        const geometry = await f.page.evaluate(() => {
          const stage = document.querySelector('.story-player-stage').getBoundingClientRect();
          const text = document.querySelector('.story-player-copy p').getBoundingClientRect();
          return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, stageBottom: stage.bottom, textBottom: text.bottom };
        });
        assert.ok(geometry.scroll <= geometry.width, JSON.stringify(geometry));
        assert.ok(geometry.textBottom <= geometry.stageBottom);
        await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-choices.png`), fullPage: true });
        await f.page.locator('[data-story-reset-preview="act"]').click();
        await f.page.locator('[role="dialog"]').waitFor();
        assert.equal(await f.page.locator('.story-player').evaluate((el) => el.inert), true);
        const bounds = await f.page.locator('.story-reset-dialog-panel').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.equal(await f.page.locator('[data-story-reset-confirm]').evaluate((button) => {
          const r = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }), true, 'Confirm must not be covered by site navigation');
        await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-reset.png`) });
      } finally { await f.close(); }
    });
  }
}

for (const status of ['ai_pending', 'paused', 'completed']) {
  test(`${status}: inactive progress cannot submit a choice`, async () => {
    const f = await fixture({ current: { ...projection(), status } });
    try {
      await f.ready();
      assert.equal(await f.page.locator('[data-choice-id]:not(:disabled)').count(), 0);
      await f.page.evaluate(() => {
        const button = document.createElement('button');
        button.dataset.choiceId = 'choice-0';
        document.querySelector('#storyStageRoot').append(button);
        button.click();
        button.remove();
      });
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
    } finally { await f.close(); }
  });
}

test('preview error stays on scene, releases busy and never sends reset', async () => {
  const f = await fixture({ work: true, hook: (r) => r.path.endsWith('/reset-preview') ? envelope('STORY_RELEASE_CAPABILITY_REQUIRED') : null });
  try {
    await f.ready();
    await f.page.locator('[data-story-reset-preview="full"]').click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-action-status]')?.textContent.includes('reset could not be confirmed'));
    assert.equal(await f.page.locator('[role="dialog"]').count(), 0);
    assert.equal(await f.page.locator('[data-choice-id]:not(:disabled)').count(), 3);
    assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
    assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /STORY_|INTERNAL_|story\.progress\./);
  } finally { await f.close(); }
});

test('unknown preview quota is not falsely displayed as exhausted', async () => {
  const f = await fixture({ hook: (r) => r.path.endsWith('/reset-preview') ? envelope('INTERNAL_ERROR', 500) : null });
  try {
    await f.ready();
    assert.match(await f.page.locator('[data-story-reset-preview="full"]').innerText(), /-$/);
    assert.equal(await f.page.locator('[data-story-reset-preview]:disabled').count(), 2);
  } finally { await f.close(); }
});

test('stale preview is discarded and current revision refetched', async () => {
  const f = await fixture({ work: true });
  try {
    await f.ready();
    f.setCurrent({ ...projection(), revision: 9 });
    await f.page.locator('[data-story-reset-preview="act"]').click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-action-status]')?.textContent.includes('progress has changed'));
    assert.equal(await f.page.locator('[role="dialog"]').count(), 0);
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.waitForFunction(() => document.querySelector('[data-story-scene-focus]')?.textContent.includes('distinct-route-0'));
    assert.equal(f.requests.find((r) => r.method === 'POST').body.expectedRevision, 9);
  } finally { await f.close(); }
});

test('choice stays busy through refetch; no replay during loading', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let posted = false;
  let refetching = false;
  const f = await fixture({ hook: async (r) => {
    if (r.method === 'POST') posted = true;
    if (posted && r.path.endsWith('/current-scene')) { refetching = true; await gate; }
  } });
  try {
    await f.ready();
    await f.page.locator('[data-choice-id]').first().click();
    while (!refetching) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(await f.page.locator('#storyStageRoot').getAttribute('aria-busy'), 'true');
    await f.page.evaluate(() => {
      const b = document.createElement('button'); b.dataset.choiceId = 'choice-1';
      document.querySelector('#storyStageRoot').append(b); b.click(); b.remove();
    });
    assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
    release();
    await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false');
  } finally { release(); await f.close(); }
});

test('late locale response cannot replace the newest locale', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture({ hook: async (r) => {
    if (r.path.endsWith('/current-scene') && r.query.locale === 'ja') {
      await gate; return { body: projection(2, 'ja') };
    }
    if (r.path.endsWith('/current-scene') && r.query.locale === 'zh-Hant') return { body: projection(1, 'zh-Hant') };
  } });
  try {
    await f.ready();
    await f.page.evaluate(() => { window.testLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
    await f.page.evaluate(() => { window.testLocale = 'zh-Hant'; window.dispatchEvent(new Event('lumina:localechange')); });
    await f.page.waitForFunction(() => document.querySelectorAll('[data-choice-id]').length === 1);
    release();
    await f.page.waitForTimeout(80);
    assert.equal(await f.page.locator('[data-choice-id]').count(), 1);
    assert.match(await f.page.locator('[data-choice-id]').innerText(), /在門前/);
  } finally { release(); await f.close(); }
});

test('late prior-session POST and finally cannot replace or unlock a new session', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const nextSession = '33333333-3333-4333-8333-333333333333';
  const f = await fixture({ work: true, hook: async (r) => {
    if (r.method === 'POST') { await gate; return { body: { ...projection(), revision: 4 } }; }
    if (r.path.includes(nextSession)) return { body: { ...projection(1, 'ja'), progressId: nextSession, revision: 1 } };
  } });
  try {
    await f.ready();
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.evaluate(({ nextSession, workId }) => {
      history.pushState(null, '', `/story-stage?sessionId=${nextSession}&workId=${workId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, { nextSession, workId });
    await f.page.waitForFunction(() => document.querySelectorAll('[data-choice-id]').length === 1);
    release();
    await f.page.waitForTimeout(80);
    assert.equal(await f.page.locator('[data-choice-id]').count(), 1);
    assert.match(await f.page.locator('[data-choice-id]').innerText(), /扉の前/);
    assert.equal(f.requests.filter((r) => r.path.includes(sessionId) && r.path.endsWith('/current-scene')).length, 1);
  } finally { release(); await f.close(); }
});

test('reset duplicate click is ignored and lost response only refetches', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture({ work: true, hook: async (r) => {
    if (r.path.endsWith('/reset')) { await gate; return { abort: true }; }
  } });
  try {
    await f.ready();
    await f.page.locator('[data-story-reset-preview="full"]').click();
    await f.page.locator('[data-story-reset-confirm]').click();
    assert.equal(await f.page.locator('[data-story-reset-confirm]').isDisabled(), true);
    await f.page.locator('[data-story-reset-confirm]').dispatchEvent('click');
    release();
    await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false' && !document.querySelector('[role="dialog"]'));
    assert.equal(f.requests.filter((r) => r.path.endsWith('/reset')).length, 1);
  } finally { release(); await f.close(); }
});

test('actual shared apiFetch envelope is handled, no auth data required', async () => {
  const f = await fixture({ apiHelper: true, hook: (r) => r.method === 'POST' ? envelope('STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED') : null });
  try {
    await f.ready();
    await f.page.locator('[data-choice-id]').first().click();
    await f.page.locator('.story-state h2').waitFor();
    assert.equal(await f.page.locator('[data-choice-id], [data-story-retry]').count(), 0);
    assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /STORY_|INTERNAL_|story\.progress\./);
  } finally { await f.close(); }
});

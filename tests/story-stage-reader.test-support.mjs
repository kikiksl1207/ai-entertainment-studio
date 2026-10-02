import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadStoryServerContract } from './story-stage-server-contract.mjs';

// Private browser fixtures only; registered in the existing single-browser runner.
export function registerReaderTests({ fixture, projection, sessionId, workId, artifacts, locales, repo }) {
  const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
  const gate = () => { let release; return { promise: new Promise((resolve) => { release = resolve; }), release: () => release() }; };
  const paragraphs = {
    ko: '창가에 앉은 사람은 오래된 편지를 천천히 펼쳤다. 종이에는 지나온 길과 아직 끝나지 않은 약속이 적혀 있었다. 바람이 문틈을 지나갈 때마다 그는 다음 문장을 다시 읽었다.',
    en: 'The reader unfolded the old letter beside the window. Every paragraph recalled a different part of the journey and a promise still waiting to be kept. Outside, the morning light moved across the courtyard.',
    ja: '窓辺で古い手紙をゆっくりと開いた。そこには歩いてきた道のことと、まだ果たされていない約束が書かれていた。風が戸口を通り抜けるたびに、次の文章を読み返した。',
    'zh-Hans': '坐在窗边的人慢慢展开旧信。纸上写着走过的道路，以及尚未完成的约定。每当风穿过门缝，他便重新阅读下一段文字，确认没有遗漏任何一句话。',
    'zh-Hant': '坐在窗邊的人慢慢展開舊信。紙上寫著走過的道路，以及尚未完成的約定。每當風穿過門縫，他便重新閱讀下一段文字，確認沒有遺漏任何一句話。',
  };
  function current(options = {}) {
    const value = projection(options.completed ? 0 : 3, options.locale || 'en');
    value.currentBeatPosition = options.position ?? 0;
    value.scene.id = options.generated ? 'generated-reader-scene' : 'canonical-reader-scene';
    value.scene.isGenerated = Boolean(options.isGenerated);
    value.scene.beats = (options.positions || [1, 2, 3]).map((position, i) => ({ position,
      content: options.long ? `${i + 1}\n\n${(paragraphs[options.locale || 'ko'] + '\n\n').repeat(48)}END ${i + 1}` :
        ['FIRST.text', 'MIDDLE text\nSecond paragraph.', 'LAST text', 'FOURTH text', 'FIFTH text', 'SIXTH text'][i] }));
    if (options.endingMarker) value.scene.endingType = 'author_main';
    if (options.visual) value.scene.visualManifest = { background: { publicAssetPath: '/local-reader-asset.png' }, characters: [{ publicAssetPath: '/local-reader-asset.png', placement: 'right' }] };
    return value;
  }
  const beatPosts = (f) => f.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/beat'));
  async function reader(options = {}) {
    return fixture({ ...options, work: true, apiHelper: true, readerAuth: 'reader-a', current: options.current || current(options), hook: async (r, context) => {
      const override = await options.hook?.(r, context);
      if (override) return override;
      if (r.method === 'POST' && r.path.endsWith('/beat')) {
        assert.equal(r.path, `/api/v1/me/story-progress/${sessionId}/beat`);
        assert.equal(r.body.expectedRevision, context.current.revision);
        assert.ok(context.current.scene.beats.some((beat) => beat.position === r.body.position));
        const next = { ...context.current, currentBeatPosition: r.body.position, revision: context.current.revision + 7 };
        context.setCurrent(next);
        return { body: next };
      }
    } });
  }
  async function turn(f, direction, counter) {
    await f.page.locator(`[data-story-beat="${direction}"]`).click();
    await f.page.waitForFunction((counter) => document.querySelector('[data-story-beat-counter]')?.textContent === counter && document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') !== 'true', counter);
  }
  async function assertReaderStartsBelowHeader(f) {
    const bounds = await f.page.evaluate(() => ({
      top: document.querySelector('.story-current-title, .story-reader-shell').getBoundingClientRect().top,
      headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom,
    }));
    assert.ok(bounds.top >= bounds.headerBottom + 8 && bounds.top <= bounds.headerBottom + 20, JSON.stringify(bounds));
  }

  const resetVersionCopy = {
    ko: '원고가 업데이트되어 이전 버전의 막으로 돌아갈 수 없습니다.',
    en: 'The manuscript has been updated. Acts from the previous version are unavailable.',
    ja: '原稿が更新されたため、以前の版の幕には戻れません。',
    'zh-Hans': '原稿已更新，无法返回旧版本的幕。',
    'zh-Hant': '原稿已更新，無法返回舊版本的幕。',
  };
  for (const locale of locales) for (const width of [390, 1280]) {
    test(`reader: reset version changed preserves full restart (${locale}/${width})`, async () => {
      const f = await reader({ locale, width, position: 3, hook: async request => {
        if (request.path.endsWith('/reset-preview') && request.query.target === 'act') return { status: 409,
          body: { success: false, error: { code: 'STORY_RESET_VERSION_MISMATCH',
            message: 'INTERNAL_DIAGNOSTIC_DO_NOT_RENDER', details: { retryable: false } } } };
      } });
      try {
        await f.ready();
        await f.page.locator('[data-story-reset-preview="act"]').click();
        await f.page.waitForFunction(expected => document.querySelector('[data-story-action-status]')?.textContent === expected,
          resetVersionCopy[locale]);
        assert.equal(await f.page.locator('.story-reset-dialog').count(), 0);
        assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/reset')).length, 0);
        assert(!await f.page.locator('#storyStageRoot').textContent().then(text => text.includes('INTERNAL_DIAGNOSTIC_DO_NOT_RENDER')));
        assert(await f.page.locator('[data-story-reset-preview="full"]').isEnabled());
        const fits = await f.page.locator('[data-story-action-status]').evaluate(node => node.scrollWidth <= node.clientWidth + 1);
        assert(fits, 'Localized failure must fit the existing status region');
        await f.page.screenshot({ path: path.join(artifacts, `reset-version-${locale}-${width}.png`), fullPage: true });
        await f.page.locator('[data-story-reset-preview="full"]').click();
        await f.page.locator('.story-reset-dialog').waitFor();
        assert.equal(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/reset')).length, 0);
        await f.page.locator('[data-story-reset-cancel]').click();
        assert.equal(await f.page.locator('.story-reset-dialog').count(), 0);
        assert.equal(f.errors.length, 0);
      } finally { await f.close(); }
    });
  }

  for (const options of [{ name: 'canonical sentinel', positions: [1, 2, 3] }, { name: 'canonical resumed', positions: [1, 2, 3], position: 2 }, { name: 'generated zero-based', positions: [0, 1, 2], generated: true }]) {
    test(`reader: ${options.name} exact positions/revisions, all text and choices reachable`, async () => {
      const f = await reader(options);
      try {
        await f.ready();
        assert.equal(await f.page.locator('.story-reader-shell-text-only').count(), 1);
        assert.equal(await f.page.locator('.story-player-stage, .story-player-background').count(), 0);
        const textOnlyLayout = await f.page.evaluate(() => {
          const shell = document.querySelector('.story-reader-shell');
          const pane = document.querySelector('.story-reader-pane');
          const bounds = pane.getBoundingClientRect();
          const shellBounds = shell.getBoundingClientRect();
          return {
            width: bounds.width,
            centered: Math.abs((bounds.left + bounds.right) / 2 - (shellBounds.left + shellBounds.right) / 2) <= 1,
          };
        });
        assert.ok(textOnlyLayout.width <= 761 && textOnlyLayout.centered, JSON.stringify(textOnlyLayout));
        assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), options.position ? 'MIDDLE text\nSecond paragraph.' : 'FIRST.text');
        await f.page.evaluate(() => { const button = document.createElement('button'); button.dataset.choiceId = 'choice-0'; document.querySelector('#storyStageRoot').append(button); button.click(); button.remove(); });
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0, 'Unseen later beats cannot be bypassed');
        if (!options.position) await turn(f, 'next', '2 / 3');
        await turn(f, 'next', '3 / 3');
        assert.equal(await f.page.locator('[data-choice-id]').count(), 3);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), 'LAST text');
        await turn(f, 'previous', '2 / 3');
        const posts = beatPosts(f);
        assert.deepEqual(posts.map((r) => r.body.expectedRevision), options.position ? [3, 10] : [3, 10, 17]);
        assert.deepEqual(posts.map((r) => r.body.position), options.position ? [3, 2] : options.generated ? [1, 2, 1] : [2, 3, 2]);
        assert.equal(posts[0].headers.authorization, 'Bearer local-reader-reader-a');
        assert.ok(posts.every((r) => r.query.locale === 'en' && Object.keys(r.body).length === 2));
        await f.page.reload(); await f.ready();
        assert.equal(await f.page.locator('[data-story-beat-counter]').textContent(), '2 / 3');
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, posts.length);
      } finally { await f.close(); }
    });
  }

  test('reader: only a ready, pinned participant links chat to this exact story progress', async () => {
    const value = current();
    value.participantArtist = { artistId: '22222222-2222-4222-8222-222222222222', slug: 'seo-ika',
      displayName: '서이카', visualIdentityReady: true };
    const f = await reader({ current: value });
    try {
      await f.ready();
      assert.equal(await f.page.locator('.story-participant-chat-link').getAttribute('href'),
        `/character-chat?slug=seo-ika&storyProgressId=${sessionId}`);
      assert.equal(await f.page.locator('.story-participant-chat-link').innerText(), 'Chat with your story companion');
      const link = f.page.locator('.story-participant-chat-link');
      assert.equal(await link.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    } finally { await f.close(); }
    const pending = current();
    pending.participantArtist = { ...value.participantArtist, visualIdentityReady: false };
    const unavailable = await reader({ current: pending });
    try {
      await unavailable.ready();
      assert.equal(await unavailable.page.locator('.story-participant-chat-link').count(), 0);
    } finally { await unavailable.close(); }
  });

  test('reader: a one-page generated scene checkpoints its visible beat before the next choice', async () => {
    const f = await reader({ generated: true, isGenerated: true, positions: [1, 2] });
    try {
      await f.ready();
      assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3,
        await f.page.locator('#storyStageRoot').innerText());
      await f.page.locator('[data-choice-id="choice-1"]').click();
      await f.page.waitForFunction(() => document.querySelector('.story-player-copy p')?.textContent === 'distinct-route-1');
      const posts = f.requests.filter(request => request.method === 'POST');
      assert.deepEqual(posts.map(request => request.path.split('/').at(-1)), ['beat', 'choice-1']);
      assert.deepEqual(posts[0].body, { position: 2, expectedRevision: 3 });
      assert.equal(posts[1].body.expectedRevision, 10);
    } finally { await f.close(); }
  });

  test('reader: a rejected generated beat checkpoint never submits the choice', async () => {
    const f = await reader({ generated: true, isGenerated: true, positions: [1, 2], hook: (request) => {
      if (request.method === 'POST' && request.path.endsWith('/beat')) {
        return { status: 409, body: { code: 'STORY_PROGRESS_STALE_REVISION' } };
      }
    } });
    try {
      await f.ready();
      await f.page.locator('[data-choice-id="choice-1"]').click();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') !== 'true');
      assert.deepEqual(f.requests.filter(request => request.method === 'POST')
        .map(request => request.path.split('/').at(-1)), ['beat']);
    } finally { await f.close(); }
  });

  test('reader: a generated beat projection from another route never submits the choice', async () => {
    const f = await reader({ generated: true, isGenerated: true, positions: [1, 2], hook: (request, context) => {
      if (request.method !== 'POST' || !request.path.endsWith('/beat')) return null;
      return { body: { ...context.current, currentBeatPosition: request.body.position,
        revision: context.current.revision + 7, storyVersion: 'different-route-version' } };
    } });
    try {
      await f.ready();
      await f.page.locator('[data-choice-id="choice-1"]').click();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') !== 'true');
      assert.deepEqual(f.requests.filter(request => request.method === 'POST')
        .map(request => request.path.split('/').at(-1)), ['beat']);
    } finally { await f.close(); }
  });

  test('reader: six short pages render as three longer scenes and save only scene boundaries', async () => {
    const f = await reader({ positions: [1, 2, 3, 4, 5, 6] });
    try {
      await f.ready();
      assert.equal(await f.page.locator('[data-story-beat-counter]').textContent(), '1 / 3');
      assert.deepEqual(await f.page.locator('.story-player-copy p').allTextContents(), ['FIRST.text', 'MIDDLE text\nSecond paragraph.']);
      await turn(f, 'next', '2 / 3');
      assert.deepEqual(await f.page.locator('.story-player-copy p').allTextContents(), ['LAST text', 'FOURTH text']);
      await turn(f, 'next', '3 / 3');
      assert.deepEqual(await f.page.locator('.story-player-copy p').allTextContents(), ['FIFTH text', 'SIXTH text']);
      assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
      assert.deepEqual(beatPosts(f).map((request) => request.body.position), [4, 6]);
    } finally { await f.close(); }
  });

  test('reader: active ending marker does not complete progress or hide final three choices', async () => {
    const f = await reader({ endingMarker: true });
    try {
      await f.ready(); await turn(f, 'next', '2 / 3'); await turn(f, 'next', '3 / 3');
      assert.equal(await f.page.locator('.story-ending-label').count(), 0);
      assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
      await f.page.locator('[data-choice-id="choice-0"]').click();
      await f.page.waitForFunction(() => document.querySelector('.story-player-copy p')?.textContent === 'distinct-route-0');
      assert.deepEqual(f.requests.filter((r) => r.method === 'POST').map((r) => r.path.split('/').at(-1)), ['beat', 'beat', 'choice-0']);
    } finally { await f.close(); }
  });

  test('reader: completed multi-beat ending is fully readable locally, no saved-position claim or write', async () => {
    const f = await reader({ completed: true });
    try {
      await f.ready(); await turn(f, 'next', '2 / 3'); await turn(f, 'next', '3 / 3');
      assert.equal(await f.page.locator('.story-player-copy p').textContent(), 'LAST text');
      assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
      assert.equal(await f.page.locator('.story-ending-label').count(), 1);
      await turn(f, 'previous', '2 / 3');
      await f.page.reload(); await f.ready();
      assert.equal(await f.page.locator('[data-story-beat-counter]').textContent(), '1 / 3');
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
      assert.doesNotMatch(await f.page.locator('[data-story-action-status]').innerText(), /saved|saving/i);
    } finally { await f.close(); }
    // Actual service projection after an ending such as 75A: no current scene.
    const contract = await loadStoryServerContract(repo)({ state: 'completed-null' });
    const ending = await contract.current();
    assert.equal(ending.status, 'completed'); assert.equal(ending.scene, null); assert.deepEqual(ending.choices, []);
    const completed = await reader({ current: ending });
    try {
      await completed.ready();
      assert.equal(await completed.page.locator('.story-completed h2').textContent(), 'Completed');
      assert.equal(await completed.page.locator('.story-player-stage, [data-story-beat], [data-choice-id], .story-state').count(), 0);
      assert.equal(await completed.page.locator('[data-story-reset-preview="full"]:enabled').count(), 1);
      assert.equal(await completed.page.locator('[data-story-scene-focus]').evaluate((el) => el === document.activeElement), true);
      assert.equal(completed.requests.filter((r) => r.method === 'POST').length, 0);
      assert.deepEqual(contract.writes, []);
    } finally { await completed.close(); }
  });

  for (const { locale, width } of [{ locale: 'ko', width: 390 }, { locale: 'en', width: 400 },
    { locale: 'ja', width: 1280 }, { locale: 'zh-Hans', width: 390 }, { locale: 'zh-Hant', width: 400 }]) {
    test(`reader generated ending: ${locale} ${width}px saves navigation without reopening choices`, async () => {
      const value = current({ completed: true, generated: true, isGenerated: true, locale });
      value.scene.endingType = 'ai_generated';
      value.scene.beats = Array.from({ length: 6 }, (_, index) => ({ position: index + 1,
        content: `${paragraphs[locale]} ${index + 1}.` }));
      const f = await reader({ locale, width, current: value });
      try {
        await f.ready();
        await turn(f, 'next', '2 / 3');
        await turn(f, 'next', '3 / 3');
        assert.deepEqual(beatPosts(f).map(request => request.body.position), [4, 6]);
        assert.deepEqual(beatPosts(f).map(request => request.body.expectedRevision), [3, 10]);
        assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
        assert.equal(await f.page.locator('.story-ending-label').count(), 1);
        await f.page.reload(); await f.ready();
        assert.equal(await f.page.locator('[data-story-beat-counter]').textContent(), '3 / 3');
        await turn(f, 'previous', '2 / 3');
        assert.deepEqual(beatPosts(f).map(request => request.body.position), [4, 6, 4]);
        const layout = await f.page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          buttons: [...document.querySelectorAll('[data-story-beat]')].map(button => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
          }),
        }));
        assert.ok(layout.scroll <= layout.width, JSON.stringify(layout));
        assert.ok(layout.buttons.every(button => button.left >= 0 && button.right <= layout.width && button.width >= 44), JSON.stringify(layout));
        await f.page.screenshot({ path: path.join(artifacts, `generated-ending-${locale}-${width}.png`), fullPage: true });
      } finally { await f.close(); }
    });
  }

  function readyEnding(locale = 'en') {
    const value = current({ completed: true, generated: true, isGenerated: true, locale, positions: [1], long: true, visual: true });
    value.scene.beats[0].content += '.';
    value.scene.deliveryState = 'ready';
    value.scene.endingType = 'ai_generated';
    return value;
  }

  for (const { locale, width } of [{ locale: 'ko', width: 390 }, { locale: 'en', width: 400 },
    { locale: 'ja', width: 1280 }, { locale: 'zh-Hans', width: 390 }, { locale: 'zh-Hant', width: 400 }]) {
    test(`reader ending acknowledgement: ${locale} ${width}px single page saves only on explicit click`, async () => {
      const value = readyEnding(locale);
      const f = await reader({ locale, width, current: value });
      try {
        await f.ready();
        const button = f.page.locator('[data-story-ending-read]');
        await button.waitFor();
        assert.equal(await button.isDisabled(), false);
        assert.equal(await f.page.locator('[data-story-beat], [data-choice-id]').count(), 0);
        assert.equal(beatPosts(f).length, 0);
        await button.scrollIntoViewIfNeeded();
        const before = await f.page.evaluate(() => scrollY);
        const metrics = await button.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const prose = document.querySelector('.story-player-copy').getBoundingClientRect();
          return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right,
            top: bounds.top, proseBottom: prose.bottom, overflow: document.documentElement.scrollWidth > innerWidth,
            textFits: element.scrollWidth <= element.clientWidth };
        });
        assert.ok(metrics.width >= 44 && metrics.height >= 44 && metrics.left >= 0 && metrics.right <= width, JSON.stringify(metrics));
        assert.ok(metrics.top >= metrics.proseBottom && !metrics.overflow && metrics.textFits, JSON.stringify(metrics));
        await f.page.screenshot({ path: path.join(artifacts, `ending-read-ack-${locale}-${width}.png`) });
        await button.click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-ending-read]')?.disabled && document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'false');
        assert.equal(await button.evaluate(element => element.getBoundingClientRect().width), metrics.width, 'Saved label must not resize the button');
        assert.deepEqual(beatPosts(f).map(request => request.body), [{ position: 1, expectedRevision: 3 }]);
        assert.ok(Math.abs(await f.page.evaluate(() => scrollY) - before) <= 2, 'Acknowledgement must not jump to the page start');
        await button.dispatchEvent('click');
        assert.equal(beatPosts(f).length, 1);
        await f.page.reload(); await f.ready();
        assert.equal(await button.isDisabled(), true);
        assert.equal(await f.page.locator('.story-ending-label').count(), 1);
        assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
        assert.equal(beatPosts(f).length, 1);
        assert.ok(f.requests.filter(request => request.method === 'POST').every(request => request.path.endsWith('/beat')));
      } finally { await f.close(); }
    });
  }

  test('reader ending acknowledgement: pending click blocks duplicate and reset writes', async () => {
    const g = gate();
    const f = await reader({ current: readyEnding(), hook: async request => { if (request.path.endsWith('/beat')) await g.promise; } });
    try {
      await f.ready();
      const button = f.page.locator('[data-story-ending-read]');
      await button.click();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'true');
      await button.dispatchEvent('click');
      await f.page.locator('[data-story-reset-preview="full"]').dispatchEvent('click');
      assert.equal(await button.isDisabled(), true);
      g.release();
      await f.page.waitForFunction(() => document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'false');
      assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
      assert.equal(await button.isDisabled(), true);
    } finally { g.release(); await f.close(); }
  });

  test('reader ending acknowledgement: a hidden unfinished tail cannot be marked fully read', async () => {
    const value = readyEnding();
    value.scene.beats[0].content = 'The final letter was opened. Unfinished hidden tail';
    const f = await reader({ current: value });
    try {
      await f.ready();
      assert.equal(await f.page.locator('.story-player-copy p').textContent(), 'The final letter was opened.');
      assert.equal(await f.page.locator('[data-story-ending-read]').count(), 0);
      await f.page.evaluate(() => {
        const button = document.createElement('button');
        button.dataset.storyEndingRead = '';
        document.querySelector('#storyStageRoot').append(button);
        button.click(); button.remove();
      });
      assert.equal(beatPosts(f).length, 0);
    } finally { await f.close(); }
  });

  for (const outcome of ['lost committed', 'forbidden']) {
    test(`reader ending acknowledgement: ${outcome} never replays a write`, async () => {
      const f = await reader({ current: readyEnding(), hook: async (request, context) => {
        if (!request.path.endsWith('/beat')) return;
        if (outcome === 'forbidden') return { status: 403, body: { error: { code: 'PRIVATE_INTERNAL', message: 'PRIVATE_SECRET' } } };
        context.setCurrent({ ...context.current, revision: 10, currentBeatPosition: 1 });
        return { abort: true };
      } });
      try {
        await f.ready();
        await f.page.locator('[data-story-ending-read]').click();
        await f.page.waitForFunction(() => document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'false');
        assert.equal(beatPosts(f).length, 1);
        assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
        assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /PRIVATE_INTERNAL|PRIVATE_SECRET/);
        if (outcome === 'lost committed') {
          assert.ok(f.requests.filter(request => request.path.endsWith('/current-scene')).length >= 2);
          assert.equal(await f.page.locator('[data-story-ending-read]').isDisabled(), true);
          assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
        } else assert.equal(await f.page.locator('[data-story-ending-read], .story-player').count(), 0);
      } finally { await f.close(); }
    });
  }

  for (const invalid of ['duplicate positions', 'unknown position', 'active ending without choices', 'completed with choices']) {
    test(`reader: ${invalid} is a surfaced contract error`, async () => {
      const value = current();
      if (invalid === 'duplicate positions') value.scene.beats[1].position = 1;
      if (invalid === 'unknown position') value.currentBeatPosition = 8;
      if (invalid === 'active ending without choices') { value.choices = []; value.scene.endingType = 'author_main'; }
      if (invalid === 'completed with choices') value.status = 'completed';
      const f = await reader({ current: value });
      try { await f.ready(); assert.equal(await f.page.locator('.story-player, [data-choice-id], .story-ending-label').count(), 0); assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0); }
      finally { await f.close(); }
    });
  }

  for (const outcome of ['failed', 'lost committed', 'stale', 'timeout', 'changed scene', 'changed release']) {
    test(`reader: ${outcome} refetches authority, never auto-replays or consumes other quotas`, async () => {
      const g = gate();
      const f = await reader({ hook: async (r, c) => {
        if (!r.path.endsWith('/beat')) return;
        const next = { ...c.current, revision: 21, currentBeatPosition: 2 };
        if (outcome === 'changed scene') next.scene = { ...next.scene, id: 'new-authoritative-scene', beats: [{ position: 2, content: 'NEW SCENE' }] };
        if (outcome === 'changed release') next.storyVersion = 2;
        if (outcome !== 'failed') c.setCurrent(next);
        if (outcome === 'timeout') { await g.promise; return { body: next }; }
        if (outcome === 'lost committed') return { abort: true };
        if (outcome.startsWith('changed')) return { body: next };
        return { status: outcome === 'stale' ? 409 : 503, body: { error: { code: outcome === 'stale' ? 'STORY_PROGRESS_STALE_REVISION' : 'PRIVATE_DIAGNOSTIC', message: 'SECRET' } } };
      } });
      try {
        await f.ready();
        if (outcome === 'timeout') await f.page.clock.install();
        await f.page.locator('[data-story-beat="next"]').click();
        if (outcome === 'timeout') { await f.page.clock.runFor(15100); g.release(); }
        await f.page.waitForFunction(() => document.querySelector('.story-player') && document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'false');
        assert.equal(beatPosts(f).length, 1);
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
        assert.ok(f.requests.filter((r) => r.path.endsWith('/current-scene')).length >= 2);
        assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /PRIVATE_DIAGNOSTIC|SECRET/);
        if (outcome === 'changed scene') assert.equal(await f.page.locator('.story-player-copy p').textContent(), 'NEW SCENE');
        else assert.equal(await f.page.locator('[data-story-beat-counter]').textContent(), outcome === 'failed' ? '1 / 3' : '2 / 3');
      } finally { g.release(); await f.close(); }
    });
  }

  test('reader: slow beat blocks duplicate navigation, choice and reset until acknowledgement', async () => {
    const g = gate();
    const f = await reader({ hook: async (r) => { if (r.path.endsWith('/beat')) await g.promise; } });
    try {
      await f.ready(); await f.page.locator('[data-story-beat="next"]').click();
      await f.page.locator('[data-story-beat="next"]').dispatchEvent('click');
      await f.page.locator('[data-story-reset-preview="full"]').dispatchEvent('click');
      assert.equal(await f.page.locator('[data-story-beat]:enabled').count(), 0);
      g.release();
      await f.page.waitForFunction(() => document.querySelector('[data-story-beat-counter]')?.textContent === '2 / 3');
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
    } finally { g.release(); await f.close(); }
  });

  for (const change of ['locale', 'account', 'back', 'work']) {
    test(`reader: slow reply fenced after ${change}`, async () => {
      const g = gate();
      const f = await reader({ hook: async (r, c) => {
        if (r.path.endsWith('/beat')) { const old = { ...c.current, revision: 10, currentBeatPosition: 2, scene: { ...c.current.scene, beats: [{ position: 2, content: 'OLD PRIVATE REPLY' }] } }; await g.promise; return { body: old }; }
        if (r.path.endsWith('/current-scene') && (r.query.locale === 'ja' || r.headers.authorization === 'Bearer local-reader-reader-b')) return { body: { ...c.current, scene: { ...c.current.scene, beats: [{ position: 0, content: 'CURRENT READER' }] } } };
        if (r.path === '/api/v1/stories') return { body: { items: [], nextCursor: null } };
      } });
      try {
        await f.ready(); await f.page.locator('[data-story-beat="next"]').click();
        if (change === 'locale') await f.page.evaluate(() => { window.testLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
        if (change === 'account') await f.page.evaluate(() => { window.testReaderUser = 'reader-b'; window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })); });
        if (change === 'back') await f.page.evaluate(() => { history.pushState(null, '', '/story-stage'); window.dispatchEvent(new PopStateEvent('popstate')); });
        if (change === 'work') await f.page.evaluate((sessionId) => { history.pushState(null, '', `/story-stage?sessionId=${sessionId}&workId=99999999-9999-4999-8999-999999999999`); window.dispatchEvent(new PopStateEvent('popstate')); }, sessionId);
        g.release(); await delay(200);
        assert.doesNotMatch(await f.page.locator('#storyStageRoot').innerText(), /OLD PRIVATE REPLY/);
        assert.equal(beatPosts(f).length, 1);
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
        if (change === 'locale' || change === 'account') assert.equal(await f.page.locator('.story-player-copy p').textContent(), 'CURRENT READER');
      } finally { g.release(); await f.close(); }
    });
  }

  test('reader: reset dialog preserves page scroll; page turns return to the start and focus', async () => {
    const f = await reader({ long: true });
    try {
      await f.ready();
      await f.page.locator('[data-story-scene-focus]').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY + 180));
      await f.page.locator('[data-story-reset-preview="full"]').click();
      const before = await f.page.evaluate(() => scrollY);
      await f.page.locator('[data-story-reset-cancel]').click();
      assert.ok(Math.abs(await f.page.evaluate(() => scrollY) - before) <= 2);
      await turn(f, 'next', '2 / 3');
      await assertReaderStartsBelowHeader(f);
      assert.equal(await f.page.locator('[data-story-scene-focus]').evaluate((el) => el === document.activeElement), true);
      await f.page.locator('[data-story-reset-preview="full"]').click();
      await f.page.locator('[data-story-reset-confirm]').click();
      await f.page.waitForFunction(() => document.querySelector('.story-player-copy p') && !document.querySelector('[data-story-beat-counter]'));
      assert.equal(f.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/reset')).length, 1);
    } finally { await f.close(); }
  });

  test('reader: long text never forces a scroll receipt; last-beat choices and rereading preserve access', async () => {
    const f = await reader({ long: true });
    try {
      await f.ready();
      assert.equal(await f.page.locator('[data-story-beat="next"]').isDisabled(), false);
      assert.equal(await f.page.locator('[data-choice-id]').count(), 0);
      await f.page.evaluate(() => { const b = document.createElement('button'); b.dataset.choiceId = 'choice-0'; document.querySelector('#storyStageRoot').append(b); b.click(); b.remove(); });
      assert.equal(f.requests.filter((r) => r.path.includes('/choices/')).length, 0);
      await turn(f, 'next', '2 / 3'); await turn(f, 'next', '3 / 3');
      assert.equal(await f.page.locator('[data-story-scene-focus]').evaluate((el) => el.scrollTop), 0);
      assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
      await turn(f, 'previous', '2 / 3'); await turn(f, 'next', '3 / 3');
      assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
      assert.equal(await f.page.evaluate(() => window.getAuth().user.id), 'reader-a');
      assert.ok(f.requests.filter((r) => r.method === 'POST').every((r) => r.path.endsWith('/beat')));
    } finally { await f.close(); }
  });

  for (const generated of [false, true]) {
    test(`reader server: actual beat update revision and completed write refusal generated=${generated}`, async () => {
      const c = await loadStoryServerContract(repo)({ state: 'active', generated, beats: current({ generated }).scene.beats, readerChoices: projection().choices });
      const f = await reader({ current: await c.current(), hook: async (r) => {
        if (r.path.endsWith('/current-scene')) return { body: await c.current() };
        if (r.path.endsWith('/beat')) { try { return { body: await c.beat(r.body.position, r.body.expectedRevision) }; } catch (e) { return { status: e.getStatus(), body: e.getResponse() }; } }
      } });
      try {
        await f.ready(); await turn(f, 'next', '2 / 3');
        assert.deepEqual(c.writes, ['beat-update']);
        assert.equal((await c.current()).revision, 8);
        const completed = await loadStoryServerContract(repo)({ state: 'completed-scene', generated, beats: current().scene.beats });
        await assert.rejects(completed.beat(2, 7), (e) => e.getStatus() === 409);
        assert.deepEqual(completed.writes, []);
      } finally { await f.close(); }
    });
  }

  for (const width of [820, 900, 1024, 1100]) {
    test(`reader visual: ${width}px navigation stays inside the viewport`, async () => {
      const f = await reader({ locale: 'ko', width, current: current({ locale: 'ko', long: true, visual: true }) });
      try {
        await f.ready();
        const layout = await f.page.evaluate(() => {
          const buttons = [...document.querySelectorAll('[data-story-beat]')].map((button) => button.getBoundingClientRect());
          const links = [...document.querySelectorAll('.main-nav a')].map((link) => link.getBoundingClientRect());
          const copy = document.querySelector('.story-player-copy');
          return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            buttonsFit: buttons.every((r) => r.left >= 0 && r.right <= innerWidth && r.width >= 44),
            linksFit: links.every((r) => r.left >= 0 && r.right <= innerWidth && r.height < 50),
            pageScrolls: document.documentElement.scrollHeight > innerHeight,
            copyScrolls: copy.scrollHeight > copy.clientHeight + 2 };
        });
        assert.equal(layout.documentWidth <= layout.viewportWidth, true, JSON.stringify(layout));
        assert.equal(layout.buttonsFit && layout.linksFit, true, JSON.stringify(layout));
        assert.equal(layout.pageScrolls && !layout.copyScrolls, true, JSON.stringify(layout));
        await f.page.locator('[data-story-beat="next"]').click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-beat-counter]')?.textContent === '2 / 3');
        await assertReaderStartsBelowHeader(f);
      } finally { await f.close(); }
    });
  }

  for (const width of [320, 360, 390, 1280]) {
    test(`reader typography: Korean prose and choices remain legible at ${width}px`, async () => {
      const value = current({ locale: 'ko', position: 3, visual: true });
      value.scene.beats[2].content = '창가에 놓인 편지를 다시 펼쳤다. 접힌 자국 사이로 오래전 적어 둔 이름이 보였다.\n\n그 이름을 읽자 지난밤의 대화가 떠올랐다. 지금 문을 열면 모든 것이 달라질 수 있었다.';
      const f = await reader({ locale: 'ko', width, current: value });
      try {
        await f.ready();
        const typography = await f.page.evaluate(() => {
          const prose = getComputedStyle(document.querySelector('.story-player-copy p'));
          const choice = getComputedStyle(document.querySelector('.story-choice-list button'));
          return { proseSize: parseFloat(prose.fontSize), proseLineHeight: parseFloat(prose.lineHeight),
            proseFamily: prose.fontFamily, proseWidth: prose.maxWidth, choiceSize: parseFloat(choice.fontSize),
            choiceWeight: Number(choice.fontWeight), choiceFamily: choice.fontFamily,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(typography.proseSize, width <= 680 ? 17 : 18);
        assert.ok(typography.proseLineHeight / typography.proseSize >= 1.75);
        assert.match(typography.proseFamily, /^system-ui/);
        assert.equal(typography.choiceSize, 15);
        assert.equal(typography.choiceWeight, 500);
        assert.match(typography.choiceFamily, /^system-ui/);
        assert.equal(typography.horizontalOverflow, false);
        await f.page.locator('.story-player-copy').evaluate((element) => {
          const headerHeight = document.querySelector('.site-header').getBoundingClientRect().height;
          scrollTo({ top: element.getBoundingClientRect().top + scrollY - headerHeight - 12, behavior: 'instant' });
        });
        await f.page.screenshot({ path: path.join(artifacts, `ko-${width}-typography.png`) });
      } finally { await f.close(); }
    });
  }

  for (const { locale, width } of [{ locale: 'ko', width: 390 }, { locale: 'en', width: 900 }, { locale: 'ja', width: 1280 }]) {
    for (const titled of [false, true]) {
      test(`reader header clearance: ${locale} ${width} ${titled ? 'titled' : 'untitled'} scene`, async () => {
        const value = current({ locale, long: true, visual: true });
        if (titled) value.scene.title = 'Norse mythology';
        const f = await reader({ locale, width, current: value });
        try {
          await f.ready();
          await turn(f, 'next', '2 / 3');
          const clearance = await f.page.evaluate(() => {
            const header = document.querySelector('.site-header').getBoundingClientRect();
            const anchor = document.querySelector('.story-current-title, .story-reader-shell').getBoundingClientRect();
            const copy = document.querySelector('.story-player-copy');
            return { headerBottom: header.bottom, anchorTop: anchor.top,
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              copyScrolls: copy.scrollHeight > copy.clientHeight + 2 };
          });
          assert.ok(clearance.anchorTop >= clearance.headerBottom + 8 && clearance.anchorTop <= clearance.headerBottom + 20, JSON.stringify(clearance));
          assert.equal(clearance.horizontalOverflow || clearance.copyScrolls, false, JSON.stringify(clearance));
          if (width > 820) {
            const stage = await f.page.evaluate(() => {
              const copy = document.querySelector('.story-player-copy');
              window.scrollTo(0, copy.getBoundingClientRect().top + scrollY + 500);
              return { top: document.querySelector('.story-player-stage').getBoundingClientRect().top,
                headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom };
            });
            assert.ok(stage.top >= stage.headerBottom + 8, JSON.stringify(stage));
          }
          await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-${titled ? 'title' : 'no-title'}-header-clearance.png`) });
        } finally { await f.close(); }
      });
    }
  }

  for (const locale of locales) for (const width of [390, 400, 1280]) {
    test(`reader visual: ${locale} ${width} long text uses the page scroll`, async () => {
      const value = current({ locale, long: true, visual: true });
      const f = await reader({ locale, width, current: value });
      try {
        await f.ready();
        const region = f.page.locator('[data-story-scene-focus]');
        assert.equal(await f.page.locator('[data-story-beat="next"]').isDisabled(), false);
        assert.equal((await region.locator('p').allTextContents()).join('\n\n'), value.scene.beats[0].content);
        const geometry = await f.page.evaluate(() => {
          const stage = document.querySelector('.story-player-stage'); const region = document.querySelector('[data-story-scene-focus]'); const nav = document.querySelector('.story-beat-navigation');
          const narrativeStyle = getComputedStyle(region.querySelector('p'));
          const stageBounds = stage.getBoundingClientRect(); const regionBounds = region.getBoundingClientRect();
          return { stageHeight: stageBounds.height, stageRatio: stageBounds.width / stageBounds.height, regionScrolls: region.scrollHeight > region.clientHeight + 2, horizontal: document.documentElement.scrollWidth <= innerWidth,
            stacked: regionBounds.top > stageBounds.bottom, sideBySide: regionBounds.left > stageBounds.right, navRendered: nav.getBoundingClientRect().width >= 44,
            topDelta: Math.abs(stageBounds.top - regionBounds.top), bottomDelta: Math.abs(stageBounds.bottom - regionBounds.bottom),
            documentHeight: document.documentElement.scrollHeight, narrative: { fontSize: parseFloat(narrativeStyle.fontSize), fontWeight: narrativeStyle.fontWeight, lineHeight: parseFloat(narrativeStyle.lineHeight) } };
        });
        assert.ok(geometry.stageHeight > 190 && geometry.stageHeight <= 610);
        assert.ok(geometry.stageRatio > 1.76 && geometry.stageRatio < 1.79 && geometry.stacked, JSON.stringify(geometry));
        assert.equal(geometry.regionScrolls, false); assert.equal(geometry.horizontal, true); assert.equal(geometry.navRendered, true);
        assert.ok(geometry.documentHeight > 2400, 'Long beat must remain in the page scroll');
        assert.ok(geometry.narrative.fontSize >= 16);
        assert.ok(['400', '500'].includes(geometry.narrative.fontWeight));
        assert.ok(geometry.narrative.lineHeight / geometry.narrative.fontSize >= 1.74);
        const next = f.page.locator('[data-story-beat="next"]');
        const hoverCapable = await f.page.evaluate(() => matchMedia('(hover: hover)').matches);
        if (width > 680 && hoverCapable) {
          await next.focus();
          assert.equal(await next.evaluate((el) => document.activeElement === el), true);
        } else assert.equal(await next.evaluate((el) => getComputedStyle(el).opacity), '1');
        await region.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
        assert.equal(await region.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight + 2), true);
        await f.page.waitForFunction(() => {
          const images = [...document.querySelectorAll('.story-player-background, .story-player-characters img')];
          return images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0);
        });
        assert.equal(await f.page.locator('.story-player-background, .story-player-characters img').evaluateAll((images) => images.length === 2 && images.every((el) => el.complete && el.naturalWidth > 0)), true);
        assert.equal(await f.page.locator('.story-player-no-visual').isHidden(), true);
        await next.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const nextBounds = await next.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, y: r.y, uncovered: el.contains(top), covering: top?.outerHTML.slice(0, 300) }; });
        assert.ok(nextBounds.width >= 44 && nextBounds.height >= 44 && nextBounds.uncovered, JSON.stringify(nextBounds));
        await region.focus();
        await f.page.keyboard.press('ArrowRight');
        await f.page.waitForFunction(() => document.querySelector('[data-story-beat-counter]')?.textContent === '2 / 3' && document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') !== 'true');
        await turn(f, 'next', '3 / 3');
        assert.equal((await region.locator('p').allTextContents()).join('\n\n'), value.scene.beats[2].content);
        assert.equal(await f.page.locator('[data-choice-id]').count(), 3);
        await region.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
        await f.page.locator('[data-choice-id]').first().waitFor();
        assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
        assert.equal(await f.page.locator('textarea').count(), 0);
        for (const choice of await f.page.locator('[data-choice-id]').all()) {
          await choice.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
          assert.equal(await choice.evaluate((el) => { const r = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
        }
        const labels = await f.page.locator('[data-story-beat]').evaluateAll((buttons) => buttons.map((button) => ({ label: button.getAttribute('aria-label'), title: button.title })));
        assert.ok(labels.every(({ label, title }) => label && label === title && !label.includes('story.')));
        const captureBounds = [];
        for (const choice of await f.page.locator('[data-choice-id]').all()) {
          await choice.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
          captureBounds.push(await choice.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, uncovered: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }));
        }
        assert.ok(captureBounds.every((choice) => choice.uncovered), JSON.stringify(captureBounds));
        await f.page.screenshot({ path: path.join(artifacts, `${locale}-${width}-reader.png`) });
        await writeFile(path.join(artifacts, `${locale}-${width}-reader.json`), JSON.stringify({ locale, width, height: 844, ...geometry,
          fullTextCharacters: value.scene.beats.map((beat) => beat.content.length), displayedBeat: 3, reachableChoices: 3,
          loadedImages: 2, choiceHitTargetsUncovered: true, navigationLabels: labels, captureBounds,
          caption: 'Private intercepted fixture: 16:9 visual stage and separate editorial reading panel; last beat displayed and three choices reachable. The visible bitmap is the checked-in brand-logo test asset, not generated story artwork.' }, null, 2));
      } finally { await f.close(); }
    });
  }

  test('reader visual: portrait art keeps an uncropped side-by-side composition on desktop', async () => {
    const value = current({ locale: 'ko', long: true, visual: true });
    value.scene.visualManifest.background.publicAssetPath = '/local-reader-portrait.webp';
    const f = await reader({ locale: 'ko', width: 1280, current: value });
    try {
      await f.ready();
      await f.page.waitForFunction(() => document.querySelector('.story-reader-shell')?.dataset.visualLayout === 'portrait');
      const layout = await f.page.evaluate(() => {
        const image = document.querySelector('.story-player-background');
        const stage = document.querySelector('.story-player-stage').getBoundingClientRect();
        const copy = document.querySelector('.story-player-copy').getBoundingClientRect();
        return { imageRatio: image.naturalWidth / image.naturalHeight, stageRatio: stage.width / stage.height,
          sideBySide: copy.left >= stage.right, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(layout.imageRatio > 0.65 && layout.imageRatio < 0.68, JSON.stringify(layout));
      assert.ok(layout.stageRatio > 0.65 && layout.stageRatio < 0.68, JSON.stringify(layout));
      assert.equal(layout.sideBySide && !layout.horizontalOverflow, true, JSON.stringify(layout));
    } finally { await f.close(); }
  });

  test('reader visual: portrait art, prose, and three choices stay reachable on mobile', async () => {
    for (const width of [320, 820]) {
      const value = current({ locale: 'ko', position: 3, visual: true });
      value.scene.visualManifest.background.publicAssetPath = '/local-reader-portrait.webp';
      value.scene.beats[2].content = `${paragraphs.ko}\n\n${paragraphs.ko}`;
      value.choices.forEach((choice) => { choice.label = Array(3).fill(paragraphs.ko).join(' '); });
      const f = await reader({ locale: 'ko', width, current: value });
      try {
        await f.ready();
        await f.page.waitForFunction(() => document.querySelector('.story-reader-shell')?.dataset.visualLayout === 'portrait');
        const layout = await f.page.evaluate(() => {
          const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
          const stage = bounds('.story-player-stage');
          const copy = bounds('.story-player-copy');
          const choices = bounds('.story-choice-panel');
          const navigation = bounds('.story-beat-navigation');
          const image = document.querySelector('.story-player-background');
          return { stageRatio: stage.width / stage.height, imageRatio: image.naturalWidth / image.naturalHeight,
            imageVisible: image.offsetWidth > 0 && image.offsetHeight > 0,
            ordered: stage.bottom <= copy.top + 1 && copy.bottom <= choices.top + 1 && choices.bottom <= navigation.top + 1,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            proseClipped: document.querySelector('.story-player-copy').scrollHeight > document.querySelector('.story-player-copy').clientHeight };
        });
        assert.ok(Math.abs(layout.stageRatio - layout.imageRatio) < 0.02, JSON.stringify({ width, ...layout }));
        assert.equal(layout.imageVisible && layout.ordered && !layout.horizontalOverflow && !layout.proseClipped, true, JSON.stringify({ width, ...layout }));
        assert.deepEqual(await f.page.locator('.story-player-copy p').allTextContents(), [paragraphs.ko, paragraphs.ko]);
        assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
        for (const choice of await f.page.locator('[data-choice-id]').all()) {
          await choice.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
          assert.equal(await choice.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.scrollHeight <= element.clientHeight &&
              element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }), true, `${width}px choice text or hit target is clipped`);
        }
        await f.page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await f.page.screenshot({ path: path.join(artifacts, `ko-${width}-portrait-reader.png`), fullPage: true });
      } finally { await f.close(); }
    }
  });
}

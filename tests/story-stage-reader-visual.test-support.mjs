import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

// All images and API responses are private intercepted fixtures, never story art.
export function registerReaderVisualTests({ fixture, projection, sessionId, workId, artifacts, locales }) {
  const gate = () => { let release; return { promise: new Promise((resolve) => { release = resolve; }), release: () => release() }; };
  const clone = (value) => structuredClone(value);
  const backgroundA = '/local-reader-background-a.png';
  const backgroundB = '/local-reader-background-b.png';
  function context(key, background = backgroundA) {
    return { sourceSceneKey: key, assetReadiness: 'ready', manifest: { sceneKey: key,
      background: { state: 'ready', publicAssetPath: background, altKey: 'story.scene.background' },
      characters: [{ characterKey: 'private-character', expressionKey: 'neutral', placement: 'left',
        publicAssetPath: `/local-reader-character.png?scene=${key}`, fallbackUsed: false }] } };
  }
  function current({ locale = 'en', positions = [1, 2, 3], long = false } = {}) {
    const value = projection(3, locale);
    const text = value.scene.beats[0].content;
    value.scene.visualManifest = context('legacy').manifest;
    value.scene.characters = [{ imageUrl: '/local-reader-character.png?legacy=1', placement: 'center' }];
    value.scene.beats = positions.map((position, index) => ({ position,
      content: `${index + 1}\n\n${long ? (text + '\n\n').repeat(24) : text}`,
      visualContext: context(index < 2 ? 'source-a' : 'source-b', index < 2 ? backgroundA : backgroundB) }));
    return value;
  }
  async function reader(options = {}) {
    return fixture({ ...options, work: true, apiHelper: true, readerAuth: 'reader-a', current: options.current || current(options),
      hook: async (request, state) => {
        const result = await options.hook?.(request, state);
        if (result) return result;
        if (request.method === 'POST' && request.path.endsWith('/beat')) {
          assert.equal(request.body.expectedRevision, state.current.revision);
          const next = { ...state.current, currentBeatPosition: request.body.position, revision: state.current.revision + 7 };
          state.setCurrent(next); return { body: next };
        }
      } });
  }
  async function turn(f, direction, counter) {
    await f.page.locator(`[data-story-beat="${direction}"]`).click();
    await f.page.waitForFunction((counter) => document.querySelector('[data-story-beat-counter]')?.textContent === counter && document.querySelector('#storyStageRoot')?.getAttribute('aria-busy') === 'false', counter);
  }
  async function loaded(f, url, count = 1) {
    await f.page.waitForFunction(({ url, count }) => {
      const bg = document.querySelector('.story-player-background');
      const characters = [...document.querySelectorAll('.story-player-characters img')];
      return bg?.getAttribute('src') === url && !bg.hidden && bg.complete && bg.naturalWidth > 0 &&
        characters.length === count && characters.every((el) => !el.hidden && el.complete && el.naturalWidth > 0);
    }, { url, count });
  }
  async function missing(f) {
    await f.page.waitForFunction(() => document.querySelector('.story-player-stage')?.dataset.visualStatus === 'missing' && !document.querySelector('.story-player-background'));
    assert.equal(await f.page.locator('.story-player-no-visual').isVisible(), true);
    assert.equal(await f.page.locator('.story-player').getAttribute('data-has-background'), 'false');
  }
  async function imagePixels(f) {
    const samples = await f.page.locator('.story-player-stage img').evaluateAll((images) => images.map((image) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      const colors = new Set(); let opaque = 0; let fingerprint = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]) opaque++;
        colors.add([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]].join(','));
        for (let channel = 0; channel < 4; channel++) fingerprint = Math.imul(fingerprint ^ pixels[i + channel], 16777619) >>> 0;
      }
      return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, visible: !image.hidden,
        sampledPixels: 256, opaquePixels: opaque, distinctColors: colors.size, fingerprint };
    }));
    assert.equal(samples.length, 2);
    assert.ok(samples.every((sample) => sample.naturalWidth > 0 && sample.naturalHeight > 0 && sample.visible && sample.opaquePixels > 0 && sample.distinctColors > 1));
    return samples;
  }

  for (const absent of [undefined, null]) {
    test(`beat visual: legacy ${String(absent)} context retains scene background and characters`, async () => {
      const value = current(); value.scene.beats.forEach((beat) => { beat.visualContext = absent; });
      const f = await reader({ current: value });
      try {
        await f.ready(); await loaded(f, backgroundA);
        assert.equal(await f.page.locator('.story-player-characters img').getAttribute('src'), '/local-reader-character.png?legacy=1');
        assert.equal(await f.page.locator('.story-player-characters img').getAttribute('data-side'), 'center');
        await turn(f, 'next', '2 / 3'); await loaded(f, backgroundA);
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
      } finally { await f.close(); }
    });
  }

  for (const positions of [[1, 2, 3], [0, 1, 2]]) {
    test(`beat visual: positions ${positions} bind source A/A/B consistently across next/previous`, async () => {
      const value = current({ positions });
      const f = await reader({ current: value });
      try {
        await f.ready(); await loaded(f, backgroundA);
        const pixelsA = await imagePixels(f);
        const characterA = await f.page.locator('.story-player-characters img').getAttribute('src');
        await turn(f, 'next', '2 / 3'); await loaded(f, backgroundA);
        assert.deepEqual(await imagePixels(f), pixelsA);
        assert.equal(await f.page.locator('.story-player-characters img').getAttribute('src'), characterA);
        await turn(f, 'next', '3 / 3'); await loaded(f, backgroundB);
        assert.notEqual((await imagePixels(f))[0].fingerprint, pixelsA[0].fingerprint);
        assert.notEqual(await f.page.locator('.story-player-characters img').getAttribute('src'), characterA);
        assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
        await turn(f, 'previous', '2 / 3'); await loaded(f, backgroundA);
        assert.deepEqual(f.requests.filter((r) => r.method === 'POST').map((r) => r.body), [
          { position: positions[1], expectedRevision: 3 }, { position: positions[2], expectedRevision: 10 }, { position: positions[1], expectedRevision: 17 }]);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[1].content);
      } finally { await f.close(); }
    });
  }

  for (const mode of ['imported missing fallback', 'ready background 404']) {
    test(`beat visual: ${mode} leaves neutral readable stage without broken images`, async () => {
      const value = current(); const visual = value.scene.beats[0].visualContext;
      visual.manifest.background.publicAssetPath = '/assets/story/fallback.webp';
      if (mode.startsWith('imported')) { visual.assetReadiness = 'missing'; visual.manifest.background.state = 'fallback'; }
      visual.manifest.characters = [];
      const f = await reader({ current: value });
      try {
        await f.ready(); await missing(f);
        assert.equal(await f.page.locator('.story-player-stage img').count(), 0);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[0].content);
        assert.equal(await f.page.locator('[data-story-beat="next"]').isEnabled(), true);
        assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
      } finally { await f.close(); }
    });
  }

  test('beat visual: one failed character removes only its layer; fallback and offscreen cast never load', async () => {
    const value = current(); const characters = value.scene.beats[0].visualContext.manifest.characters;
    characters.push({ ...characters[0], publicAssetPath: '/local-reader-character.png?bad=1', placement: 'right' },
      { ...characters[0], publicAssetPath: '/local-reader-character.png?substitute=1', fallbackUsed: true },
      { ...characters[0], publicAssetPath: '/local-reader-character.png?offscreen=1', placement: 'offscreen' });
    const f = await reader({ current: value, assetHook: (r) => r.query.bad ? { status: 404, body: '' } : null });
    try {
      await f.ready(); await loaded(f, backgroundA);
      assert.equal(await f.page.locator('.story-player-stage').getAttribute('data-visual-status'), 'ready');
      assert.equal(await f.page.locator('.story-player-no-visual').isHidden(), true);
      assert.ok(f.assetRequests.every((r) => !r.query.substitute && !r.query.offscreen && !r.query.legacy));
    } finally { await f.close(); }
  });

  test('beat visual: only a verified missing prompt requests one optional generated image', async () => {
    const value = current(); const visual = value.scene.beats[0].visualContext;
    visual.generationAvailable = true;
    visual.assetReadiness = 'missing';
    visual.manifest.background = { state: 'fallback', publicAssetPath: '/assets/story/fallback.webp',
      altKey: 'story.scene.fallback' };
    visual.manifest.characters = [];
    const f = await reader({ current: value });
    try {
      await f.ready();
      await f.page.waitForFunction(() => performance.getEntriesByType('resource').length >= 0);
      await f.page.waitForTimeout(100);
      const requests = f.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/scene-visual'));
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].body, { sourceSceneKey: 'source-a' });
      assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[0].content);
    } finally { await f.close(); }
  });

  test('beat visual: a loaded fallback bitmap is not promoted to ready story artwork', async () => {
    const value = current(); const visual = value.scene.beats[0].visualContext;
    visual.assetReadiness = 'missing'; visual.manifest.background.state = 'fallback'; visual.manifest.characters = [];
    const f = await reader({ current: value });
    try {
      await f.ready(); await loaded(f, backgroundA, 0);
      assert.equal(await f.page.locator('.story-player-stage').getAttribute('data-visual-status'), 'fallback');
      assert.equal(await f.page.locator('.story-player-no-visual').isVisible(), true);
    } finally { await f.close(); }
  });

  for (const invalid of ['source key', 'readiness', 'unapproved state']) {
    test(`beat visual: invalid ${invalid} does not borrow enclosing scene art`, async () => {
      const value = current(); const visual = value.scene.beats[0].visualContext;
      if (invalid === 'source key') visual.sourceSceneKey = 'another-source';
      if (invalid === 'readiness') visual.assetReadiness = 'unknown';
      if (invalid === 'unapproved state') visual.assetReadiness = 'missing';
      const f = await reader({ current: value });
      try {
        await f.ready(); await missing(f);
        assert.equal(await f.page.locator('.story-player-stage img').count(), 0);
        assert.equal(f.assetRequests.length, 0);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[0].content);
      } finally { await f.close(); }
    });
  }

  for (const transition of ['next/previous', 'choice', 'reset', 'account', 'locale', 'session']) {
    test(`beat visual: late old image load/error cannot replace layers after ${transition}`, async () => {
      const g = gate(); const value = current();
      const held = context('held', backgroundA + '?hold=1'); held.manifest.characters[0].publicAssetPath += '&hold=1';
      value.scene.beats[0].visualContext = clone(held); value.scene.beats[1].visualContext = clone(held);
      if (transition === 'choice') { value.currentBeatPosition = 3; value.scene.beats[2].visualContext = clone(held); }
      const replacement = current(); replacement.revision = 4; replacement.storyVersion = 2; replacement.scene.id = 'replacement-scene';
      replacement.scene.beats.forEach((beat) => { beat.visualContext = context('source-b', backgroundB); });
      const f = await reader({ current: value, pendingAssets: true,
        assetHook: async (r) => { if (r.query.hold) { await g.promise; return { status: 404, body: '' }; } },
        hook: (r, state) => {
          if (r.method === 'POST' && r.path.includes('/choices/')) { state.setCurrent(replacement); return { body: replacement }; }
          if (r.method === 'POST' && r.path.endsWith('/reset')) { state.setCurrent(replacement); return { body: { target: 'full', beforeRevision: 3, afterRevision: 4, status: 'completed' } }; }
        } });
      try {
        await f.ready();
        await f.page.evaluate(() => { window.oldReadingImages = [...document.querySelectorAll('.story-player-stage img')]; });
        assert.equal(await f.page.locator('.story-player-stage img:not([hidden])').count(), 0);
        if (transition === 'next/previous') {
          await turn(f, 'next', '2 / 3'); await turn(f, 'next', '3 / 3');
          await turn(f, 'previous', '2 / 3'); await turn(f, 'next', '3 / 3');
        } else if (transition === 'choice') await f.page.locator('[data-choice-id="choice-0"]').click();
        else if (transition === 'reset') {
          await f.page.locator('[data-story-reset-preview="full"]').click();
          await f.page.locator('[data-story-reset-confirm]').click();
        } else {
          if (transition === 'session') replacement.progressId = '99999999-9999-4999-8999-999999999999';
          f.setCurrent(replacement);
          if (transition === 'account') await f.page.evaluate(() => { window.testReaderUser = 'reader-b'; window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })); });
          if (transition === 'locale') await f.page.evaluate(() => { window.testLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
          if (transition === 'session') await f.page.evaluate(({ id, workId }) => { history.pushState(null, '', `/story-stage?sessionId=${id}&workId=${workId}`); window.dispatchEvent(new PopStateEvent('popstate')); }, { id: replacement.progressId, workId });
        }
        await loaded(f, backgroundB);
        const html = await f.page.locator('.story-player-stage').innerHTML();
        g.release();
        await f.page.evaluate(() => { for (const image of window.oldReadingImages) { image.dispatchEvent(new Event('load')); image.dispatchEvent(new Event('error')); } });
        await f.page.waitForTimeout(80);
        await loaded(f, backgroundB);
        assert.equal(await f.page.locator('.story-player-stage').innerHTML(), html);
        assert.equal(await f.page.locator('.story-player-stage').getAttribute('data-visual-status'), 'ready');
        assert.ok(f.requests.filter((r) => r.method === 'POST').every((r) => r.path.endsWith('/beat') || r.path.includes('/choices/') || r.path.endsWith('/reset')));
      } finally { g.release(); await f.close(); }
    });
  }

  test('beat visual: delayed background settlement preserves exact text, focus and partial reading scroll', async () => {
    const g = gate(); const value = current({ long: true });
    value.scene.beats[0].visualContext.manifest.background.publicAssetPath += '?hold=1';
    const f = await reader({ current: value, pendingAssets: true, assetHook: async (r) => { if (r.query.hold) { await g.promise; return { status: 404, body: '' }; } } });
    try {
      await f.ready();
      await f.page.locator('[data-story-scene-focus]').evaluate((el) => { el.focus(); el.scrollTop = 145; });
      g.release(); await missing(f);
      assert.equal(await f.page.locator('[data-story-scene-focus]').evaluate((el) => el.scrollTop), 145);
      assert.equal(await f.page.locator('[data-story-scene-focus]').evaluate((el) => el === document.activeElement), true);
      assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[0].content);
      assert.equal(await f.page.locator('.story-player-characters img').count(), 1);
      assert.equal(f.requests.filter((r) => r.method === 'POST').length, 0);
    } finally { g.release(); await f.close(); }
  });

  for (const locale of locales) for (const width of [390, 400, 1280]) {
    test(`beat visual layout: ${locale} ${width} missing/ready scenes keep all text and controls reachable`, async () => {
      const value = current({ locale, long: true });
      const first = value.scene.beats[0].visualContext;
      first.assetReadiness = 'missing'; first.manifest.background = { state: 'fallback', publicAssetPath: '/assets/story/fallback.webp' }; first.manifest.characters = [];
      value.scene.beats[1].visualContext = clone(value.scene.beats[2].visualContext);
      const f = await reader({ locale, width, current: value });
      try {
        await f.ready(); await missing(f);
        assert.equal(await f.page.locator('.story-player-copy p').textContent(), value.scene.beats[0].content);
        const region = f.page.locator('[data-story-scene-focus]');
        await region.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        assert.equal(await region.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2), true);
        await turn(f, 'next', '2 / 3'); await loaded(f, backgroundB);
        assert.equal(await region.locator('p').textContent(), value.scene.beats[1].content);
        await turn(f, 'next', '3 / 3'); await loaded(f, backgroundB);
        assert.equal(await region.locator('p').textContent(), value.scene.beats[2].content);
        assert.equal(await f.page.locator('[data-choice-id]:enabled').count(), 3);
        assert.equal(await region.evaluate((el) => el.scrollTop), 0);
        await region.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const metrics = await f.page.evaluate(() => {
          const region = document.querySelector('[data-story-scene-focus]'); const stage = document.querySelector('.story-player-stage');
          const font = getComputedStyle(region.querySelector('p')); const nav = document.querySelector('.story-beat-navigation');
          return { stageHeight: stage.getBoundingClientRect().height, regionHeight: region.clientHeight, fullTextReachable: Math.abs(region.scrollHeight - region.clientHeight - region.scrollTop) < 2,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth, contained: region.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom && nav.getBoundingClientRect().top >= stage.getBoundingClientRect().bottom,
            fontSize: parseFloat(font.fontSize), fontWeight: font.fontWeight, lineHeight: parseFloat(font.lineHeight), documentHeight: document.documentElement.scrollHeight };
        });
        assert.equal(metrics.horizontalOverflow, false); assert.equal(metrics.contained, true); assert.equal(metrics.fullTextReachable, true);
        assert.ok(metrics.stageHeight <= 622 && metrics.documentHeight < 2400);
        assert.equal(metrics.fontSize, 16); assert.equal(metrics.fontWeight, '400'); assert.equal(metrics.lineHeight, 27.2);
        const pixels = await imagePixels(f);
        await f.page.evaluate(() => { const region = document.querySelector('[data-story-scene-focus]').getBoundingClientRect(); const header = document.querySelector('.site-header').getBoundingClientRect(); window.scrollTo({ top: scrollY + region.top - header.height - 12, behavior: 'instant' }); });
        const controlsVisible = await f.page.locator('[data-choice-id], [data-story-beat]').evaluateAll((buttons) => buttons.every((el) => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
        assert.equal(controlsVisible, true);
        const prefix = path.join(artifacts, `${locale}-${width}-beat-visual`);
        await f.page.screenshot({ path: prefix + '.png' });
        await writeFile(prefix + '.json', JSON.stringify({ locale, width, ...metrics, pixels, controlsVisible, firstSceneMissing: true, lastSceneReady: true, loadedImages: 2,
          fullTextCharacters: value.scene.beats.map((beat) => beat.content.length), caption: 'Local intercepted fixture only. Missing source scene uses neutral CSS; ready scene uses checked-in brand bitmaps to verify binding, not real story art or a public work. Final beat is scrolled to its end; earlier text remains scrollable. Global auth/header bootstrap is outside this fixture approval.' }, null, 2));
      } finally { await f.close(); }
    });
  }
}

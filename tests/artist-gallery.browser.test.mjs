import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const from = script.indexOf('let gallerySliderEvents = null;');
const to = script.indexOf('/* 헤더 드롭다운', from);
assert.ok(from >= 0 && to > from);

test('gallery refresh does not double-bind navigation or load every image eagerly', async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.STORY_UI_BROWSER ? { executablePath: process.env.STORY_UI_BROWSER } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`<div id="detailGallery">
      <button id="galleryPrev"></button><span id="galleryCounter"></span><button id="galleryNext"></button>
      <div id="gallerySlider" style="width:320px;height:400px"><div id="galleryTrack"></div></div>
    </div>`);
    await page.addScriptTag({ content: `
      function feedEscapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[ch]);
      }
      ${script.slice(from, to)}
    ` });
    const result = await page.evaluate(() => {
      const items = Array.from({ length: 8 }, (_, index) => ({ src: `data:image/png;base64,${index}`, caption: `Photo ${index}` }));
      const slider = document.getElementById('gallerySlider');
      let moves = 0;
      slider.scrollBy = () => { moves += 1; };
      initGallerySlider(items, '아티스트');
      initGallerySlider(items, '아티스트');
      document.getElementById('galleryNext').click();
      const loadModes = [...document.querySelectorAll('.gallery-slide img')].map(img => img.loading);
      initLightbox([{ src: '/safe.png', caption: '"><img id="injected" src=x>' }], '아티스트');
      return { moves, loadModes, injected: !!document.querySelector('#injected'),
        alt: document.querySelector('.encar-thumb')?.alt,
        thumbLoading: document.querySelector('.encar-thumb')?.loading };
    });
    assert.equal(result.moves, 1);
    assert.deepEqual(result.loadModes, ['eager', 'eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy', 'lazy']);
    assert.equal(result.injected, false);
    assert.equal(result.alt, '"><img id="injected" src=x>');
    assert.equal(result.thumbLoading, 'lazy');
    await page.close();
  } finally {
    await browser.close();
  }
});

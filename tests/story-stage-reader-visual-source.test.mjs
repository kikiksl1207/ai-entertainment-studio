import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const visualHelpers = source.slice(source.indexOf('function visualAssetUrl('), source.indexOf('function readerScope('));
const bindingHelpers = source.slice(source.indexOf('function readingVisual('), source.indexOf('function cancelBeatNavigation('));

function harness(context, legacy = {}) {
  const state = { scene: legacy, epoch: 1, locale: 'en', sessionId: 'session' };
  const reading = { beats: [{ visualContext: context }], index: 0, key: 'beat-a' };
  let currentReading = reading;
  let identity = 'reader';
  const fallback = { hidden: true };
  const player = { dataset: { hasBackground: 'false' } };
  const stage = { isConnected: true, dataset: {}, images: [],
    contains: (el) => stage.images.includes(el), closest: () => player,
    querySelector: () => fallback, querySelectorAll: () => [...stage.images] };
  function image(background) {
    const handlers = {};
    const el = { hidden: true, complete: false, naturalWidth: 0,
      classList: { contains: () => background },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      remove: () => { stage.images = stage.images.filter((x) => x !== el); },
      fire: (name) => handlers[name]() };
    stage.images.push(el);
    return el;
  }
  const api = runInNewContext(`${visualHelpers}\n${bindingHelpers}\n({ readingVisual, bindReadingImages, visualAssetUrl, sceneCharacterSide })`, {
    state, root: { querySelector: () => stage, contains: () => stage.isConnected },
    location: { origin: 'http://127.0.0.1:18700' }, URL,
    API_ORIGIN: 'https://api.lumina-stage.com',
    readerIdentity: () => identity, readableBeats: () => currentReading,
    currentRequest: (epoch, session) => epoch === state.epoch && session === state.sessionId,
  });
  return { ...api, state, reading, stage, player, fallback, image, switchIdentity: () => { identity = 'other'; },
    switchBeat: () => { currentReading = { ...reading, key: 'beat-b' }; } };
}

const context = (key = 'source-a') => ({ sourceSceneKey: key, assetReadiness: 'ready',
  manifest: { sceneKey: key, background: { state: 'ready', publicAssetPath: '/public/background.png' },
    characters: [{ publicAssetPath: '/public/character.png', placement: 'left', fallbackUsed: false }] } });

test('visual source: absent/null beat context preserves legacy visuals; explicit context owns both layers', () => {
  const legacy = { backgroundUrl: '/legacy.png', characters: [{ imageUrl: '/legacy-character.png' }] };
  for (const absent of [undefined, null]) {
    const h = harness(absent, legacy);
    assert.equal(h.readingVisual(h.reading).background, '/legacy.png');
    assert.equal(h.readingVisual(h.reading).characters[0].imageUrl, '/legacy-character.png');
  }
  const h = harness(context(), legacy);
  assert.equal(h.readingVisual(h.reading).background, '/public/background.png');
  assert.equal(h.readingVisual(h.reading).characters[0].publicAssetPath, '/public/character.png');
  assert.equal(h.sceneCharacterSide({ placement: 'left' }, 1), 'left');
});

test('visual source: invalid binding cannot borrow legacy art; fallback assets do not become ready or cast', () => {
  for (const value of [{ ...context(), sourceSceneKey: 'other' }, { ...context(), assetReadiness: 'unknown' },
    { ...context(), assetReadiness: 'missing' }]) {
    const h = harness(value, { backgroundUrl: '/legacy.png' });
    assert.equal(h.readingVisual(h.reading).background, '');
    assert.equal(h.readingVisual(h.reading).characters.length, 0);
  }
  const value = context(); value.assetReadiness = 'missing'; value.manifest.background.state = 'fallback';
  value.manifest.characters[0].fallbackUsed = true;
  const h = harness(value);
  assert.equal(h.readingVisual(h.reading).ready, false);
  assert.equal(h.readingVisual(h.reading).characters.length, 0);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,test', '//other.invalid/image.png', '/\\other.invalid/image.png', 'https://user:secret@host/image.png', 'https://public.example/image.png']) assert.equal(h.visualAssetUrl(url), '');
  assert.equal(h.visualAssetUrl('/api/v1/assets/public/id/original'), 'https://api.lumina-stage.com/api/v1/assets/public/id/original');
  assert.equal(h.visualAssetUrl('https://api.lumina-stage.com/api/v1/assets/public/id/original'), 'https://api.lumina-stage.com/api/v1/assets/public/id/original');
});

test('visual source: broken background removes only its image and reveals neutral fallback; character error is isolated', () => {
  const h = harness(context());
  const bg = h.image(true); const good = h.image(false); const bad = h.image(false);
  h.bindReadingImages(h.reading, h.readingVisual(h.reading));
  bg.naturalWidth = good.naturalWidth = 120;
  bg.fire('load'); good.fire('load'); bad.fire('error');
  assert.equal(h.stage.dataset.visualStatus, 'ready');
  assert.equal(h.fallback.hidden, true); assert.equal(good.hidden, false); assert.equal(h.stage.contains(bad), false);
  bg.fire('error');
  assert.equal(h.stage.dataset.visualStatus, 'missing'); assert.equal(h.fallback.hidden, false);
  assert.equal(h.stage.contains(bg), false); assert.equal(h.stage.contains(good), true);
});

test('visual source: cached success/failure settles without waiting for another image event', () => {
  const h = harness(context()); const bg = h.image(true); const char = h.image(false);
  bg.complete = char.complete = true; bg.naturalWidth = 100;
  h.bindReadingImages(h.reading, h.readingVisual(h.reading));
  assert.equal(bg.hidden, false); assert.equal(h.stage.contains(char), false);
});

test('visual source: detached, epoch, session, identity, locale and beat changes fence late image callbacks', () => {
  for (const change of ['detached', 'epoch', 'session', 'identity', 'locale', 'beat']) {
    const h = harness(context()); const bg = h.image(true);
    h.bindReadingImages(h.reading, h.readingVisual(h.reading));
    if (change === 'detached') h.stage.isConnected = false;
    if (change === 'epoch') h.state.epoch++;
    if (change === 'session') h.state.sessionId = 'other';
    if (change === 'identity') h.switchIdentity();
    if (change === 'locale') h.state.locale = 'ja';
    if (change === 'beat') h.switchBeat();
    bg.naturalWidth = 100; bg.fire('load'); bg.fire('error');
    assert.equal(bg.hidden, true, change); assert.equal(h.stage.contains(bg), true, change);
  }
});

test('visual source: image settlement cannot rerender text, advance progress, or override hidden-image CSS', () => {
  assert.doesNotMatch(bindingHelpers.slice(bindingHelpers.indexOf('function bindReadingImages(')), /renderScene\(|request\(|scrollTop\s*=|\.revision\s*=/);
  assert.match(css, /\.story-player-stage img\[hidden\],\s*\.story-player-no-visual\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.story-player-visual-layers,\s*\.story-player-background-layer,\s*\.story-player-background/);
  assert.match(css, /font-size: 17px;\s*font-weight: 400;\s*line-height: 1.82;/);
  assert.match(css, /\.story-hashtag-filters \{[^}]*flex-wrap: wrap;[^}]*overflow: visible;/);
  assert.match(css, /\.story-hashtag-filters::\-webkit-scrollbar \{ width: 0; height: 0; \}/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.story-hashtag-filters \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/);
  assert.doesNotMatch(source, /readBeatKeys/);
});

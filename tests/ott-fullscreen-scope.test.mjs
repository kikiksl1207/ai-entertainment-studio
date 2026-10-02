import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/ott.js', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `runtime section: ${from}`);
  return source.slice(start, end);
}

// Execute the runtime helpers and listeners, never the page bootstrap or a copied implementation.
const runtime = [
  section('  const formatTime =', '  function syncBranchButtons()'),
  section('  function syncPlayerControls()', '  async function refreshBranchAvailability()'),
  section('  toggleFullscreen.addEventListener("click"', '  playerWrap.addEventListener("keydown"'),
].join('\n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element(hidden = false) {
  const classes = new Set();
  const listeners = new Map();
  return {
    hidden, disabled: false, dataset: {}, textContent: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    addEventListener(type, callback) {
      const handlers = listeners.get(type) || [];
      handlers.push(callback);
      listeners.set(type, handlers);
    },
    fire(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function player({ touch = false, hidden = false, native = true, deferExit = false } = {}) {
  const request = deferred();
  const orientation = deferred();
  const exit = deferred();
  if (!deferExit) exit.resolve();
  const calls = { request: 0, exit: 0, locks: [], unlock: 0 };
  const playerWrap = element();
  const demoSection = element(hidden);
  const toggleFullscreen = element();
  const fullscreenExit = element(true);
  const document = Object.assign(element(), { fullscreenElement: null, body: element() });
  document.exitFullscreen = () => {
    calls.exit++;
    return exit.promise.then(() => {
      document.fullscreenElement = null;
      document.fire('fullscreenchange');
    });
  };
  if (native) playerWrap.requestFullscreen = () => { calls.request++; return request.promise; };
  const labels = {
    play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute',
    captionsOn: 'Captions on', captionsOff: 'Captions off',
    fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen', seek: 'Seek',
  };
  const context = {
    document, playerWrap, demoSection, toggleFullscreen, fullscreenExit,
    demoVideo: { paused: true, ended: false, muted: false, duration: 60, currentTime: 12 },
    togglePlayback: element(), toggleMute: element(), toggleCaptions: element(),
    choiceOverlay: element(true), videoError: element(true), seek: element(), time: element(),
    controlsCopy: { en: labels, ko: labels }, locale: () => 'en', captionsEnabled: true,
    orientationLocked: false, fullscreenOperation: null, fullscreenEpoch: 0,
    navigator: { maxTouchPoints: touch ? 1 : 0 },
    screen: { orientation: {
      lock(mode) { calls.locks.push(mode); return orientation.promise; },
      unlock() { calls.unlock++; },
    } },
  };
  const api = runInNewContext(`${runtime}\n({
    exitPlayerFullscreen, unlockOrientation, togglePlayerFullscreen, syncPlayerControls, isFullscreen
  });`, context, { filename: 'pages/ott.js (fullscreen scope)', timeout: 1000 });
  return {
    ...api, context, document, playerWrap, demoSection, toggleFullscreen, fullscreenExit,
    request, orientation, exit, calls,
    acceptNative() {
      document.fullscreenElement = playerWrap;
      document.fire('fullscreenchange');
      request.resolve();
    },
  };
}

function clean(page) {
  assert.equal(page.document.fullscreenElement, null, 'native fullscreen is absent');
  assert.equal(page.playerWrap.classList.contains('is-pseudo-fullscreen'), false);
  assert.equal(page.document.body.classList.contains('ott-fullscreen-active'), false);
  assert.equal(page.context.orientationLocked, false);
  assert.equal(page.context.fullscreenOperation, null, 'operation settles');
  assert.equal(page.fullscreenExit.hidden, true);
  if (!page.demoSection.hidden) assert.equal(page.toggleFullscreen.disabled, false);
}

test('late native rejection after exit, hide, or close/reopen never enables fallback', async () => {
  for (const cancel of ['exit', 'hidden', 'reopen']) {
    const page = player({ touch: true });
    const pending = page.togglePlayerFullscreen();
    if (cancel === 'hidden') page.demoSection.hidden = true;
    else {
      await page.exitPlayerFullscreen();
      if (cancel === 'reopen') {
        page.demoSection.hidden = true;
        page.demoSection.hidden = false;
      }
      assert.ok(page.context.fullscreenEpoch > 0, 'exit invalidates the pending request');
    }
    page.request.reject(new Error('native denied after cancellation'));
    await pending;
    clean(page);
    assert.equal(page.calls.exit, 0);
    assert.deepEqual(page.calls.locks, []);
  }
});

test('late native acceptance after exit, hide, or close/reopen is exited without locking', async () => {
  for (const cancel of ['exit', 'hidden', 'reopen']) {
    const page = player({ touch: true });
    const pending = page.togglePlayerFullscreen();
    if (cancel === 'hidden') page.demoSection.hidden = true;
    else {
      await page.exitPlayerFullscreen();
      if (cancel === 'reopen') {
        page.demoSection.hidden = true;
        page.demoSection.hidden = false;
      }
    }
    page.acceptNative();
    await pending;
    clean(page);
    assert.equal(page.calls.exit, 1, 'the stale accepted native request is released');
    assert.deepEqual(page.calls.locks, []);
  }
});

test('duplicate toggles share one operation and a closed player cannot enter fullscreen', async () => {
  const closed = player({ hidden: true });
  await closed.togglePlayerFullscreen();
  clean(closed);
  assert.equal(closed.calls.request, 0);

  const page = player();
  const first = page.togglePlayerFullscreen();
  const operation = page.context.fullscreenOperation;
  const second = page.togglePlayerFullscreen();
  assert.ok(operation, 'the pending native request owns an operation');
  assert.equal(page.context.fullscreenOperation, operation);
  assert.equal(page.toggleFullscreen.disabled, true, 'controls disable while pending');
  assert.equal(page.calls.request, 1);
  page.acceptNative();
  await Promise.all([first, second]);
  assert.equal(page.context.fullscreenOperation, null);
  assert.equal(page.toggleFullscreen.disabled, false);
  assert.equal(page.document.fullscreenElement, page.playerWrap);
  await page.exitPlayerFullscreen();
  clean(page);
});

test('the actual Escape listener cancels pending native acceptance and rejection', async () => {
  for (const accepted of [false, true]) {
    const page = player({ touch: true });
    const pending = page.togglePlayerFullscreen();
    page.document.fire('keydown', { key: 'Enter' });
    assert.equal(page.context.fullscreenEpoch, 0, 'other keys do not cancel');
    page.document.fire('keydown', { key: 'Escape' });
    assert.ok(page.context.fullscreenEpoch > 0, 'Escape cancels before native settlement');
    assert.equal(page.toggleFullscreen.disabled, true, 'cancelled request remains serialized');
    await page.togglePlayerFullscreen();
    assert.equal(page.calls.request, 1, 'cancelled pending request blocks another toggle');
    if (accepted) page.acceptNative();
    else page.request.reject(new Error('native denied after Escape'));
    await pending;
    clean(page);
    assert.equal(page.calls.exit, accepted ? 1 : 0);
    assert.deepEqual(page.calls.locks, []);
  }
});

test('late orientation settlement cannot revive a closed player and releases an acquired lock', async () => {
  for (const cancel of ['exit', 'hidden']) {
    for (const accepted of [false, true]) {
      const page = player({ touch: true, deferExit: cancel === 'exit' });
      const pending = page.togglePlayerFullscreen();
      page.acceptNative();
      await flush();
      assert.deepEqual(page.calls.locks, ['landscape']);
      assert.equal(page.toggleFullscreen.disabled, true, 'orientation await retains the operation');
      const operation = page.context.fullscreenOperation;
      await page.togglePlayerFullscreen();
      assert.equal(page.context.fullscreenOperation, operation);
      assert.equal(page.calls.exit, 0, 'duplicate toggle cannot exit during the orientation await');
      assert.equal(page.calls.request, 1);
      let exiting;
      if (cancel === 'exit') {
        exiting = page.exitPlayerFullscreen();
        assert.ok(page.context.fullscreenEpoch > 0, 'exit invalidates before its native await');
        assert.equal(page.document.fullscreenElement, page.playerWrap, 'native exit is still pending');
      } else page.demoSection.hidden = true;
      if (accepted) page.orientation.resolve();
      else page.orientation.reject(new Error('orientation denied after cancellation'));
      await flush();
      assert.equal(page.calls.unlock, accepted ? 1 : 0, 'late acquired lock is released promptly');
      if (exiting) { page.exit.resolve(); await exiting; }
      else await page.exitPlayerFullscreen();
      await pending;
      clean(page);
      assert.equal(page.calls.unlock, accepted ? 1 : 0, 'cleanup does not unlock twice');
    }
  }
});

test('active native, rejected/unavailable fallback, and optional orientation keep normal exit behavior', async () => {
  for (const mode of ['native', 'rejected', 'unavailable', 'unconfirmed', 'lock', 'lock-rejected']) {
    const page = player({ native: mode !== 'unavailable', touch: mode.startsWith('lock') });
    page.context.choiceOverlay.hidden = false;
    const pending = page.togglePlayerFullscreen();
    if (mode === 'rejected') page.request.reject(new Error('native denied'));
    else if (mode === 'unconfirmed') page.request.resolve();
    else if (mode !== 'unavailable') page.acceptNative();
    if (mode.startsWith('lock')) {
      await flush();
      if (mode === 'lock') page.orientation.resolve();
      else page.orientation.reject(new Error('orientation unsupported'));
    }
    await pending;
    const fallback = ['rejected', 'unavailable', 'unconfirmed'].includes(mode);
    assert.equal(page.document.fullscreenElement, fallback ? null : page.playerWrap, mode);
    assert.equal(page.playerWrap.classList.contains('is-pseudo-fullscreen'), fallback, mode);
    assert.equal(page.document.body.classList.contains('ott-fullscreen-active'), fallback, mode);
    assert.equal(page.context.orientationLocked, mode === 'lock');
    assert.equal(page.context.fullscreenOperation, null);
    assert.equal(page.toggleFullscreen.disabled, false);
    assert.equal(page.toggleFullscreen.ariaLabel, 'Exit fullscreen');
    assert.equal(page.fullscreenExit.hidden, false, 'choice overlay keeps its fullscreen exit');
    await page.togglePlayerFullscreen();
    page.unlockOrientation();
    clean(page);
    assert.equal(page.calls.exit, fallback ? 0 : 1);
    assert.equal(page.calls.unlock, mode === 'lock' ? 1 : 0);
  }
});

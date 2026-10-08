import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sourceWithoutCreatorsNativeReadonlyDelta } from './support/backstage-creators-native-readonly-inverse-20261009.mjs';
import { sourceWithoutLoginWidthDelta } from './support/backstage-login-width-inverse-20261009.mjs';
import { sourceWithoutCreatorsReadDelta } from './support/backstage-creators-read-inverse-compat-20261009.mjs';

const canonical = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const source = sourceWithoutCreatorsNativeReadonlyDelta(readFileSync(new URL('../backstage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const css = canonical(readFileSync(new URL('../backstage.css', import.meta.url), 'utf8'));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/backstage-login-width-exact-delta-20261009.json', import.meta.url), 'utf8'));

function interval(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert(first >= 0 && last > first);
  assert.equal(source.indexOf(start, first + 1), -1);
  assert.equal(source.indexOf(end, last + 1), -1);
  return source.slice(first, last);
}
const owned = interval(fixture.afterStartMarker, fixture.endMarker);
const nativeInit = interval('function initGoogleAuth() {', fixture.afterStartMarker);
const nativePrepare = interval('async function prepareGoogleLoginButton()', 'async function handleGoogleCredentialResponse(');
const nativeStatus = interval('function setStatus(', 'function setLoading(');

function classes() {
  const values = new Set();
  return {
    contains: value => values.has(value),
    add: value => values.add(value),
    remove: value => values.delete(value),
    toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
  };
}

// Only the owned renderer and unchanged initialization/status functions run in this memory fixture.
function harness({ width = 292, hidden = false, sdk = true, observer = true, reentrant = false } = {}) {
  const state = { width, renders: [], initializes: [], observers: [], clears: 0, failRender: false, sdkLoads: 0 };
  const handlers = new Map();
  const loginView = { classList: classes(), hidden: false, isConnected: true };
  if (hidden) loginView.classList.add('is-hidden');
  const googleButton = { isConnected: true, getBoundingClientRect: () => ({ width: state.width }) };
  const googleButtonMount = {
    isConnected: true, childElementCount: 0,
    replaceChildren() { state.clears += 1; this.childElementCount = 0; },
  };
  const googleButtonFallback = { hidden: false };
  const loginStatus = { textContent: '', classList: classes() };
  const notify = () => { for (const item of [...state.observers]) if (!item.disconnected) item.callback(); };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; state.observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  const google = { accounts: { id: {
    initialize(options) { state.initializes.push(options); },
    renderButton(mount, options) {
      state.renders.push({ ...options });
      if (state.failRender) { state.failRender = false; throw new Error('synthetic SDK failure'); }
      mount.childElementCount = 1;
      if (reentrant) notify();
    },
  } } };
  const window = {
    google: sdk ? google : undefined,
    addEventListener(name, callback) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback); },
    removeEventListener(name, callback) { handlers.get(name)?.delete(callback); },
  };
  if (observer) window.ResizeObserver = ResizeObserver;
  const fire = name => { for (const callback of [...(handlers.get(name) || [])]) callback(); };
  const context = vm.createContext({
    window, google, loginView, googleButton, googleButtonMount, googleButtonFallback, loginStatus,
    GOOGLE_CLIENT_ID: 'synthetic-memory-only', handleGoogleCredentialResponse() {},
    loadGoogleSDK() { state.sdkLoads += 1; return Promise.resolve(); }, notify, fire,
  });
  const run = code => vm.runInContext(code, context, { timeout: 200 });
  run(`let googleIdentityInitialized = false;\n${nativeInit}\n${owned}\n${nativePrepare}\n${nativeStatus}`);
  return { state, handlers, loginView, googleButton, googleButtonMount, googleButtonFallback, loginStatus, run };
}
const widths = h => h.state.renders.map(call => call.width);

test('CSS only adds login mobile min-size/wrapping rules and restores its exact canonical prefix', () => {
  assert.equal(sha(css), 'f5cbdd128de106ba9bd39b187d6be11d076f38690277ad79a77669fd04ec6144');
  const start = css.indexOf('/* BEGIN backstage-login-width-20261009 */');
  assert(start > 0);
  const delta = css.slice(start - 1);
  assert.equal(sha(delta), '4b9ad4491fc700b57badc81a316cb525e35d50144f5a44acf3dedbb07a4717dc');
  assert.equal(sha(css.slice(0, start - 1)), '831df5f25e6b93583ab3bfe54b20f14b5df37116ce01696306ba805103762d52');
  assert.match(delta, /@media \(max-width: 760px\)/);
  assert.match(delta, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(delta, /\.backstage-login \.form-status \{ overflow-wrap: anywhere; \}/);
  assert.doesNotMatch(delta, /\bbody\b|\biframe\b|overflow\s*:|\bclip\b|\bscale\b|display\s*:\s*none/);
});

test('exact JS inverse restores cbb and the unchanged creator inverse still restores1843', () => {
  assert.equal(sha(source), 'df5f352bae0df49a066035feba1feb9806ff24c2cf35d5e263a8233ed2bf3863');
  const restored = sourceWithoutLoginWidthDelta(source);
  assert.equal(sha(restored), 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341');
  assert.equal(sourceWithoutLoginWidthDelta(restored), restored);
  assert.equal(sha(sourceWithoutCreatorsReadDelta(source)), '1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409');
  assert.doesNotMatch(owned, /\bfetch\(|setBackstageAuth\(|applyAdminContext\(|\.initialize\(|\bsetInterval\(/);
});

test('inverse rejects outside/inside bytes and fixture/metadata tampering without adopting a new hash', () => {
  for (const bad of [`x${source}`, `${source}x`, source.replace('let googleLoginRenderedWidth = 0;', 'let googleLoginRenderedWidth = 1;')]) {
    assert.throws(() => sourceWithoutLoginWidthDelta(bad), { code: 'ERR_ASSERTION' });
  }
  for (const delta of [
    { ...fixture, beforeFullText: `${fixture.beforeFullText}x` },
    { ...fixture, afterFullText: `${fixture.afterFullText}x` },
    { ...fixture, afterSHA256: sha(`${source}x`) },
    { ...fixture, extra: true },
  ]) assert.throws(() => sourceWithoutLoginWidthDelta(source, delta), { code: 'ERR_ASSERTION' });
});

test('inverse permits only CRLF normalization, not other whitespace or arbitrary old inputs', () => {
  assert.equal(sourceWithoutLoginWidthDelta(source.replace(/\n/g, '\r\n')), sourceWithoutLoginWidthDelta(source));
  assert.throws(() => sourceWithoutLoginWidthDelta(` ${source}`), { code: 'ERR_ASSERTION' });
  assert.throws(() => sourceWithoutLoginWidthDelta(''), { code: 'ERR_ASSERTION' });
});

test('fresh available292 and native-observed277 render exactly with one lazy owner', () => {
  for (const width of [292, 277]) {
    const h = harness({ width });
    assert.equal(h.state.observers.length, 0);
    assert.equal(h.run('renderGoogleLoginButton()'), true);
    assert.deepEqual(widths(h), [width]);
    assert.equal(h.state.observers.length, 1);
    assert.deepEqual(h.state.observers[0].targets, [h.googleButton, h.googleButtonMount]);
    assert.equal(h.googleButtonFallback.hidden, true);
    assert.equal(h.state.renders[0].locale, 'ko');
  }
});

test('desktop uses the existing400 cap and preserves the existing240 floor', () => {
  const h = harness({ width: 430 });
  h.run('renderGoogleLoginButton()');
  h.state.width = 200;
  h.run('notify()');
  assert.deepEqual(widths(h), [400, 240]);
});

test('wide400 shrinks to292 then277; equal widths and clamped-equal desktop widths do not rerender', () => {
  const h = harness({ width: 430 });
  h.run('renderGoogleLoginButton(); notify();');
  h.state.width = 450;
  h.run('notify(); fire("resize");');
  h.state.width = 292;
  h.run('notify(); notify();');
  h.state.width = 277;
  h.run('fire("resize"); notify();');
  assert.deepEqual(widths(h), [400, 292, 277]);
  assert.equal(h.state.clears, 3);
});

test('synchronous SDK observer notifications cannot recursively rerender', () => {
  const h = harness({ reentrant: true });
  h.run('renderGoogleLoginButton(); notify();');
  h.state.width = 277;
  h.run('notify()');
  assert.deepEqual(widths(h), [292, 277]);
});

test('hidden login defers without a fake400 or owner, then the existing display call renders', () => {
  const h = harness({ width: 0, hidden: true });
  assert.equal(h.run('renderGoogleLoginButton()'), true);
  assert.deepEqual(widths(h), []);
  assert.equal(h.state.observers.length, 0);
  h.loginView.classList.remove('is-hidden');
  h.state.width = 292;
  h.run('renderGoogleLoginButton()');
  assert.deepEqual(widths(h), [292]);
});

test('visible zero/nonfinite width defers with an owned observer until measurable', () => {
  const h = harness({ width: 0 });
  assert.equal(h.run('renderGoogleLoginButton()'), true);
  h.state.width = Number.NaN;
  h.run('notify()');
  assert.deepEqual(widths(h), []);
  assert.equal(h.state.observers.length, 1);
  h.state.width = 277;
  h.run('notify()');
  assert.deepEqual(widths(h), [277]);
});

test('missing SDK has no observer and the existing prepare rejection retains fallback', async () => {
  const h = harness({ sdk: false });
  assert.equal(h.run('renderGoogleLoginButton()'), false);
  await assert.rejects(h.run('prepareGoogleLoginButton()'));
  assert.equal(h.state.observers.length, 0);
  assert.equal(h.googleButtonFallback.hidden, false);
  assert.equal(h.state.sdkLoads, 1);
});

test('native prepare initializes once and resizing changes no credentials/callback policy', async () => {
  const h = harness();
  await h.run('prepareGoogleLoginButton()');
  await h.run('prepareGoogleLoginButton()');
  h.state.width = 277;
  h.run('notify()');
  assert.equal(h.state.initializes.length, 1);
  const options = h.state.initializes[0];
  assert.equal(options.client_id, 'synthetic-memory-only');
  assert.equal(typeof options.callback, 'function');
  assert.equal(options.use_fedcm_for_button, false);
  assert.equal(options.button_auto_select, false);
  assert.equal(options.cancel_on_tap_outside, false);
  assert.deepEqual(widths(h), [292, 277]);
});

test('long error remains text-only with scoped wrapping, not geometry or auth-success evidence', () => {
  const h = harness();
  const message = 'synthetic-unbroken-error-'.repeat(80);
  h.run(`setStatus(${JSON.stringify(message)}, "error")`);
  assert.equal(h.loginStatus.textContent, message);
  assert.equal(h.loginStatus.classList.contains('is-error'), true);
  assert.match(css, /\.backstage-login \.form-status \{ overflow-wrap: anywhere; \}/);
});

test('pagehide/hidden/disconnected cleanup owns listeners and rejects stale observer callbacks', () => {
  const h = harness();
  h.run('renderGoogleLoginButton()');
  const old = h.state.observers[0];
  h.run('fire("pagehide")');
  assert.equal(old.disconnected, true);
  assert.equal(h.handlers.get('resize').size, 0);
  assert.equal(h.handlers.get('pagehide').size, 0);
  h.state.width = 277;
  old.callback();
  assert.deepEqual(widths(h), [292]);
  h.run('renderGoogleLoginButton()');
  assert.deepEqual(widths(h), [292, 277]);
  h.loginView.classList.add('is-hidden');
  h.run('notify()');
  assert.equal(h.state.observers[1].disconnected, true);
  h.loginView.classList.remove('is-hidden');
  h.run('renderGoogleLoginButton()');
  h.googleButtonMount.isConnected = false;
  h.run('notify()');
  assert.equal(h.state.observers[2].disconnected, true);
});

test('render failure exposes fallback and cleans its owner; explicit retry can restore the button', () => {
  const h = harness();
  h.state.failRender = true;
  assert.throws(() => h.run('renderGoogleLoginButton()'), /synthetic SDK failure/);
  assert.equal(h.googleButtonFallback.hidden, false);
  assert.equal(h.state.observers[0].disconnected, true);
  assert.equal(h.handlers.get('resize').size, 0);
  h.run('renderGoogleLoginButton()');
  assert.equal(h.googleButtonFallback.hidden, true);
  h.state.width = 277;
  h.state.failRender = true;
  h.run('notify()');
  assert.equal(h.googleButtonFallback.hidden, false);
  assert.equal(h.state.observers[1].disconnected, true);
});

test('without ResizeObserver the owned resize fallback still shrinks and cleans on pagehide', () => {
  const h = harness({ width: 430, observer: false });
  h.run('renderGoogleLoginButton()');
  h.state.width = 277;
  h.run('fire("resize"); fire("resize");');
  assert.deepEqual(widths(h), [400, 277]);
  assert.equal(h.state.observers.length, 0);
  h.run('fire("pagehide")');
  assert.equal(h.handlers.get('resize').size, 0);
  assert.equal(h.handlers.get('pagehide').size, 0);
});

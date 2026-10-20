'use strict';
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const test = require('node:test');
const { htmlWithoutNaverStateAppCacheDelta: cancelCompatOldProjection } = require('./support/feed-search-locale-html-inverse-20261015.cjs');
const cancelCompatFs = require('node:fs');
const cancelCompatPath = require('node:path');
const { createHash: cancelCompatCreateHash } = require('node:crypto');
const { after: cancelCompatAfter } = require('node:test');

const cancelCompatRequire = require;
const cancelCompatSelf = __filename;
function cancelCompatIdentity(raw) {
  return { bytes: raw.length,
    sha256: cancelCompatCreateHash('sha256').update(raw).digest('hex'),
    blob: cancelCompatCreateHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex') };
}
function cancelCompatMatches(raw, expected) {
  const value = cancelCompatIdentity(raw);
  return value.bytes === expected.bytes && value.sha256 === expected.sha256 && value.blob === expected.blob;
}
const cancelCompatHelperProfiles = [
  { bytes: 2382, sha256: '7a181fceda5853dd17dd3fbe604cd32d4098e629428771af5d2ab4cc381984c6',
    blob: '9dfc855aca5dbc50ebdac3e8f6a92b928174c4bc' },
  { bytes: 2435, sha256: 'ae2697cd3411c2b65e50263fd1e1c8ded29234ec2b1598cbd1dd697ecebf4061',
    blob: '7a61ba03a275323a36722fb5094e992d36abf8b7' },
];
const cancelCompatEntryProfiles = [
  { bytes: 62719, sha256: '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a',
    blob: '1a20a15b1f0814d722b97bb1abc12f32411c4e58' },
  { bytes: 63523, sha256: '77123c64ff7c6ce94bf36868fcea6f8d2fa2e2e5451a36a7683aab2e6b5c131d',
    blob: '10286286828722a4e8e6293dd77c75849e316992' },
];
const cancelCompatBeforeProfiles = [
  { bytes: 62703, sha256: '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8',
    blob: '7211a8d47738a397d0453d5708a68e4e3a9682a1' },
  { bytes: 63507, sha256: 'd43cb981b40be46c548cc10a51a3b544281134207400d1c0110b024616447be4',
    blob: 'e58b4deb1d87c84006f6c811c22046e109d5c1c5' },
];
const cancelCompatTracked = new Map();
function cancelCompatRead(file, sizes) {
  const stat = cancelCompatFs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'ordinary cancel compatibility input');
  assert(stat.size > 0 && stat.size <= 128 * 1024, 'cancel input cap before allocation');
  if (sizes) assert(sizes.includes(stat.size), 'exact cancel input size before allocation');
  assert.equal(cancelCompatFs.realpathSync.native(file).toLowerCase(),
    cancelCompatPath.resolve(file).toLowerCase(), 'no cancel input path redirection');
  const raw = cancelCompatFs.readFileSync(file);
  assert.equal(raw.length, stat.size, 'cancel input length remains stable');
  return raw;
}
function cancelCompatText(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert(Buffer.from(text, 'utf8').equals(raw), 'cancel input exact UTF8');
  assert.notEqual(text.charCodeAt(0), 0xFEFF, 'cancel input no BOM');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')),
    'cancel input LF or uniform CRLF');
  return { text, lf };
}
function cancelCompatTrack(file, raw, sizes) {
  const previous = cancelCompatTracked.get(file);
  if (previous) assert(raw.equals(previous.raw), 'cancel input unchanged between reads');
  else cancelCompatTracked.set(file, { raw, sizes });
}
const cancelCompatQPath = cancelCompatPath.join(cancelCompatPath.dirname(cancelCompatSelf),
  'support/creator-interaction-cancel-inverse-20261020.cjs');
const cancelCompatQSizes = cancelCompatHelperProfiles.map(row => row.bytes);
const cancelCompatQRaw = cancelCompatRead(cancelCompatQPath, cancelCompatQSizes);
assert(cancelCompatHelperProfiles.some(row => cancelCompatMatches(cancelCompatQRaw, row)),
  'exact whole raw cancel helper before require');
const cancelCompatQView = cancelCompatText(cancelCompatQRaw);
assert(cancelCompatMatches(Buffer.from(cancelCompatQView.lf, 'utf8'), cancelCompatHelperProfiles[0]),
  'exact whole canonical cancel helper');
cancelCompatTrack(cancelCompatQPath, cancelCompatQRaw, cancelCompatQSizes);
cancelCompatTrack(cancelCompatSelf, cancelCompatRead(cancelCompatSelf), undefined);
cancelCompatAfter(() => {
  const errors = [];
  for (const [file, row] of cancelCompatTracked) {
    try {
      const closing = cancelCompatRead(file, row.sizes);
      assert(closing.equals(row.raw), 'closing cancel compatibility raw bytes');
      assert.deepEqual(cancelCompatIdentity(closing), cancelCompatIdentity(row.raw),
        'closing cancel compatibility length/SHA/blob');
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'All cancel compatibility closing inputs attempted');
});
const cancelCompatQModule = cancelCompatRequire(cancelCompatQPath);
assert.deepEqual(Object.keys(cancelCompatQModule), ['restoreCreatorInteractionCancelHtml']);
assert.equal(typeof cancelCompatQModule.restoreCreatorInteractionCancelHtml, 'function');
function cancelCompatProjection(text) {
  if (typeof text !== 'string') return cancelCompatOldProjection(text);
  const raw = Buffer.from(text, 'utf8');
  const index = cancelCompatEntryProfiles.findIndex(row => cancelCompatMatches(raw, row));
  if (index === -1) return cancelCompatOldProjection(text);
  const file = cancelCompatPath.join(root, 'creator-studio/index.html');
  const sizes = cancelCompatEntryProfiles.map(row => row.bytes);
  const physical = cancelCompatRead(file, sizes);
  assert(cancelCompatMatches(physical, cancelCompatEntryProfiles[index]),
    'exact physical new entry before historical query view');
  assert(physical.equals(raw), 'projection sees the same physical new entry');
  assert.equal(cancelCompatText(physical).text, text, 'new entry physical text preserved');
  cancelCompatTrack(file, physical, sizes);
  const restored = cancelCompatQModule.restoreCreatorInteractionCancelHtml(text);
  assert.equal(typeof restored, 'string');
  assert(cancelCompatMatches(Buffer.from(restored, 'utf8'), cancelCompatBeforeProfiles[index]),
    'exact old entry after query-only view');
  const before = '/pages/creator-story-interactions.js?v=interactions-20261001';
  const after = '/pages/creator-story-interactions.js?v=interactions-cancel-20261020-6eb98ed7';
  assert.equal(restored.split(before).length, 2, 'one restored interaction query');
  assert.equal(restored.replace(before, after), text, 'whole query view forward');
  return cancelCompatOldProjection(restored);
}
const htmlWithoutNaverStateAppCacheDelta = cancelCompatProjection;

const root = path.resolve(process.env.CREATOR_PAYOUT_SOURCE_ROOT || path.join(__dirname, '..'));
const profile = process.env.CREATOR_PAYOUT_PROFILE || 'current';
assert(['baseline', 'current'].includes(profile));
assert(!/[\\/]story-completion-20261003(?:[\\/]|$)/i.test(realpathSync.native(root)));
const pins = {
  baseline: ['18aa1e2b8594ceb0206a9861ab2ddd89d17712ee7864e4a24ee1f754825185df',
    '10522445a90813dd68394c27f6ec9a6d2400e9b2f5b8d408b97aa1b4e4aedf2d'],
  current: ['a59a6e729b92f7795ad085d4e61afaca2fcafaf64f10d26b4e63d17369ba12f6',
    '592d4c36d3f7503759d1c3e910c00054efb9027461f5e61ff9f7e0c0db34277a'],
};
function source(relative, expected) {
  const bytes = readFileSync(path.join(root, relative));
  assert(bytes.length > 0 && bytes.length < 1024 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'));
  let lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'));
  if (relative === 'creator-studio/index.html') lf = htmlWithoutNaverStateAppCacheDelta(text).replace(/\r\n/g, '\n');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  assert(hash(bytes) === expected || hash(lf) === expected, 'Exact source or uniform checkout CRLF required');
  return lf;
}
const script = source('pages/creator-studio.js', pins[profile][0]);
const html = source('creator-studio/index.html', pins[profile][1]);
const amountIds = ['studioPayoutGrossLumina', 'studioPayoutEligibleLumina', 'studioPayoutGrossKrw',
  'studioPayoutTaxKrw', 'studioPayoutNetKrw'];
const labelIds = ['studioPayoutCurrencyLabel', 'studioPayoutFxLabel', 'studioPayoutSampleBadge', 'studioPayoutSampleNote'];
for (const id of ['studioPayoutBreakdown', ...amountIds, ...labelIds]) {
  assert.equal(html.split('id="' + id + '"').length, 2, 'Actual HTML uniquely provides payout target');
}
const entry = profile === 'current' ? 'settlement-submit-outcome-20261016-v1' : 'creator-trial-cache-20261002';
assert.equal(html.split('/pages/creator-studio.js?v=' + entry).length, 2);
const seam = '  verify();\n})();';
assert.equal(script.split(seam).length, 2, 'Only the existing final auto-verify seam may be exposed');
const exposed = script.replace(seam,
  '  window.__payoutQA = { verify, loadPayoutSummary, renderPayoutBreakdown };\n})();');
assert.equal(exposed.replace('  window.__payoutQA = { verify, loadPayoutSummary, renderPayoutBreakdown };\n})();', seam), script);

const authA = { accessToken: 'synthetic-access-a', user: { id: 'synthetic-owner-a' } };
const authB = { accessToken: 'synthetic-access-b', user: { id: 'synthetic-owner-b' } };
const full = (n = 1) => ({ totals: { grossLumina: 91 * n, eligibleLumina: 82 * n,
  grossAmount: { amount: 1234 * n }, taxAmount: { amount: 34 * n }, netAmount: { amount: 1200 * n }, currency: 'KRW' },
  fxSnapshot: { snapshotStatus: 'krw_base_no_fx' } });
const response = (data, status = 200, json) => ({ ok: status >= 200 && status < 300, status, json: json || (async () => data) });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }

function fixture() {
  const elements = new Map(), listeners = new Map(), timers = new Map(), calls = [], queue = [];
  let auth = authA, timerId = 0, storageWrites = 0;
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set(), attrs = new Map(), handlers = new Map();
    const el = { id, hidden: false, disabled: false, value: '', defaultValue: '', textContent: '', innerHTML: '',
      dataset: {}, style: {}, files: [], classList: {
        add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); },
        contains: name => classes.has(name), toggle(name, force) { const value = force === undefined ? !classes.has(name) : force;
          if (value) classes.add(name); else classes.delete(name); return value; },
      },
      addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
      click() { for (const fn of handlers.get('click') || []) fn({ target: el, preventDefault() {} }); },
      setAttribute(name, value) { attrs.set(name, String(value)); }, getAttribute: name => attrs.get(name) ?? null,
      removeAttribute(name) { attrs.delete(name); }, querySelector: selector => selector === '[data-studio-retry]' ? element('retry') : null,
      querySelectorAll: selector => id === 'studioPayoutBreakdown' && selector === '[data-payout-sample]'
        ? amountIds.map(element) : [],
      replaceChildren() { this.innerHTML = ''; }, scrollTo() {}, prepend() {}, reset() {},
    };
    elements.set(id, el);
    return el;
  }
  for (const id of amountIds) {
    const pattern = new RegExp('<strong\\b[^>]*id="' + id + '"[^>]*>([^<]*)</strong>');
    const match = pattern.exec(html);
    assert(match && match[0].includes('data-payout-sample="true"'));
    element(id).textContent = match[1]; element(id).dataset.payoutSample = 'true';
    element(id).setAttribute('aria-label', 'synthetic-unverified');
  }
  element('studioPayoutBreakdown').dataset.payoutState = 'sample';
  element('studioPayoutBreakdown').classList.add('is-payout-sample');
  const document = { body: element('body'), documentElement: Object.assign(element('html'), { lang: 'ko' }),
    getElementById: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => element('created') };
  const window = { LUMINA_API_BASE: 'https://creator.synthetic.invalid',
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); } };
  const epoch = Date.parse('2026-10-15T03:00:00Z');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [epoch])); } static now() { return epoch; } }
  const context = { window, document, URL, URLSearchParams, AbortController, DOMException, FormData, Blob, TextEncoder, TextDecoder,
    localStorage: { getItem: key => key === 'lumina_auth' ? JSON.stringify(auth) : null,
      setItem() { storageWrites++; throw new Error('Synthetic auth writes forbidden'); },
      removeItem() { storageWrites++; throw new Error('Synthetic auth writes forbidden'); } },
    sessionStorage: { getItem: () => null }, location: { hash: '' }, history: { replaceState() {} }, Date: FixedDate, Math, console,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    async fetch(url, options = {}) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://creator.synthetic.invalid');
      assert.equal(options.method || 'GET', 'GET'); assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, 'Bearer ' + auth.accessToken);
      assert(calls.length < 64, 'Bounded synthetic reads only');
      calls.push({ path: parsed.pathname, search: parsed.search });
      if (parsed.pathname === '/api/v1/me/creator-studio') return response({ access: { enabled: true },
        viewer: { userId: auth.user.id }, artists: [], summary: {} });
      if (parsed.pathname === '/api/v1/wallet') return response({ cachedBalance: '0' });
      if (parsed.pathname === '/api/v1/me/creator-studio/settlement-preview') return response({ totals: { creatorShareKrw: '0' }, items: [] });
      if (parsed.pathname === '/api/v1/me/creator-studio/payout-summary') {
        assert.equal(parsed.search, '?period=2026-10');
        assert(queue.length > 0, 'Every payout read must be explicitly scripted');
        return await queue.shift()();
      }
      assert(['/api/v1/me/creator-studio/settlement-conversions', '/api/v1/me/creator-studio/knowledge-urls'].includes(parsed.pathname),
        'No other creator request is admitted');
      return response({ items: [] });
    },
  };
  vm.runInNewContext(exposed, context, { filename: 'actual-creator-studio.js', timeout: 2000 });
  const api = window.__payoutQA;
  assert.equal(typeof api.loadPayoutSummary, 'function'); assert.equal(typeof window.LuminaCreatorStudioApi.fetch, 'function');
  const payoutCalls = () => calls.filter(call => call.path.endsWith('/payout-summary')).length;
  const snap = () => ({ values: amountIds.map(id => element(id).textContent),
    markers: amountIds.map(id => [element(id).dataset.payoutSample, element(id).getAttribute('aria-label')]),
    labels: labelIds.map(id => element(id).textContent), state: element('studioPayoutBreakdown').dataset.payoutState });
  return { api, element, calls, snap, payoutCalls, next(fn) { queue.push(fn); },
    async open(payload = full()) { queue.push(() => response(payload)); await api.verify(); await flush();
      assert.equal(element('studioShell').hidden, false); assert.equal(element('studioAccessGate').hidden, true); },
    async read(payload, status = 200) { const before = payoutCalls(); queue.push(() => response(payload, status));
      await api.loadPayoutSummary(); assert.equal(payoutCalls(), before + 1); },
    ownerB() { auth = authB; const before = calls.length;
      for (const fn of listeners.get('lumina:authchange') || []) fn({ type: 'lumina:authchange' });
      assert.equal(calls.length, before, 'Account retirement must not dispatch a new read'); },
    check(expectedPayout, expectedBootstrap = 1) { assert.equal(payoutCalls(), expectedPayout); assert.equal(queue.length, 0);
      assert.equal(calls.filter(call => call.path === '/api/v1/me/creator-studio').length, expectedBootstrap);
      assert.equal(storageWrites, 0); assert.equal(timers.size, 0); },
  };
}
function known(f, n = 1) {
  const expected = [91 * n + 'L', 82 * n + 'L', (1234 * n).toLocaleString('ko-KR') + '\uC6D0',
    (34 * n).toLocaleString('ko-KR') + '\uC6D0', (1200 * n).toLocaleString('ko-KR') + '\uC6D0'];
  assert.deepEqual(f.snap().values, expected, 'Actual full response must render before testing retirement');
  assert.equal(f.snap().state, 'estimate');
  for (const marker of f.snap().markers) assert.deepEqual(marker, ['false', null]);
}
function unknown(f, message = 'Unknown payout must not retain old amounts') {
  assert.deepEqual(f.snap().values, ['-', '-', '-', '-', '-'], message);
  assert.notEqual(f.snap().state, 'estimate');
  assert.deepEqual(f.snap().labels.slice(0, 2), ['-', '-']);
  for (const marker of f.snap().markers) { assert.equal(marker[0], 'true'); assert(marker[1]); }
}

const cases = [
  ['CREATOR.PAYOUT.CURRENT.01 full amounts retire on current failure pending unavailable and partial zero', async () => {
    const f = fixture(); await f.open(); known(f);
    const failed = deferred(); f.next(() => failed.promise);
    const request = f.api.loadPayoutSummary(); await flush(); failed.resolve(response({}, 503)); await request;
    unknown(f, 'CREATOR_PAYOUT_RETIRED_AMOUNT: old full DOM survived the current 503');
    assert.equal(f.snap().state, 'unavailable');
    const pending = deferred(); f.next(() => pending.promise); const loading = f.api.loadPayoutSummary();
    unknown(f); assert.equal(f.snap().state, 'loading'); pending.resolve(response(full(2))); await loading; known(f, 2);
    const invalid = [null, {}, { policy: { hidePayoutRow: true } },
      { policy: { hidePayoutRow: true }, totals: full().totals }, { totals: {} },
      { totals: { grossLumina: false, eligibleLumina: [], grossAmount: { amount: {} },
        taxAmount: { amount: ' ' }, netAmount: { amount: 'Infinity' } } }];
    for (const payload of invalid) { await f.read(full()); known(f); await f.read(payload); unknown(f); }
    await f.read(full());
    await f.read({ totals: { grossLumina: 0, eligibleLumina: '0', grossAmount: { amount: 0 },
      taxAmount: { amount: '' }, netAmount: { amount: false }, currency: 'KRW' } });
    assert.deepEqual(f.snap().values, ['0L', '0L', '0\uC6D0', '-', '-']);
    assert.equal(f.snap().state, 'estimate');
    assert.deepEqual(f.snap().markers.map(row => row[0]), ['false', 'false', 'false', 'true', 'true']);
    f.check(3 + invalid.length * 2 + 2);
  }],
  ['CREATOR.PAYOUT.CURRENT.02 later same-owner result survives old headers body and failure', async () => {
    for (const phase of ['headers-success', 'headers-failure', 'body-success', 'body-failure', 'network-failure']) {
      const f = fixture(); await f.open(); known(f);
      const late = deferred(); let bodyReads = 0;
      f.next(() => phase.startsWith('body-') ? response(null, 200, () => { bodyReads++; return late.promise; }) : late.promise);
      const old = f.api.loadPayoutSummary(); await flush();
      if (phase.startsWith('body-')) assert.equal(bodyReads, 1);
      await f.read(full(3)); known(f, 3); const current = f.snap();
      if (phase === 'headers-success') late.resolve(response(full(9)));
      else if (phase === 'headers-failure') late.resolve(response({}, 503));
      else if (phase === 'body-success') late.resolve(full(9));
      else late.reject(new Error('Synthetic late payout failure'));
      await old; await flush();
      assert.deepEqual(f.snap(), current, 'Old ' + phase + ' must not clear or republish over current B');
      f.check(3);
    }
  }],
  ['CREATOR.PAYOUT.CURRENT.03 owner retirement clears values without reads and old completion cannot repaint', async () => {
    for (const phase of ['headers-success', 'headers-failure', 'body-success', 'body-failure']) {
      const f = fixture(); await f.open(); known(f);
      const late = deferred(); let bodyReads = 0;
      f.next(() => phase.startsWith('body-') ? response(null, 200, () => { bodyReads++; return late.promise; }) : late.promise);
      const old = f.api.loadPayoutSummary(); await flush();
      if (phase.startsWith('body-')) assert.equal(bodyReads, 1);
      f.ownerB(); assert.equal(f.element('studioShell').hidden, true);
      assert.deepEqual(f.snap().values, ['', '', '', '', ''], 'Actual account-change handler clears the old payout');
      await f.open(full(4)); known(f, 4); const current = f.snap();
      if (phase === 'headers-success') late.resolve(response(full(9)));
      else if (phase === 'headers-failure') late.resolve(response({}, 503));
      else if (phase === 'body-success') late.resolve(full(9));
      else late.reject(new Error('Synthetic retired body failure'));
      await old; await flush(); assert.deepEqual(f.snap(), current);
      f.check(3, 2);
    }
  }],
];
const selection = process.env.CREATOR_PAYOUT_CASES || 'all';
assert(['all', 'first'].includes(selection));
for (const [name, callback] of selection === 'first' ? cases.slice(0, 1) : cases) test(name, { timeout: 10000 }, callback);

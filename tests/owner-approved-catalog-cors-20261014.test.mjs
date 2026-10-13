import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const catalogSource = readFileSync(new URL('../pages/creator-approved-reading-catalog.js', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('../pages/creator-approved-readonly-transport.js', import.meta.url), 'utf8');
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const packet = {
  contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
  readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: [{ workId, title: { value: 'Synthetic owner catalog title', locale: 'en', fallback: false, bounded: false },
    defaultLocale: 'en', recordedState: { workStatus: 'draft', approval: 'not_checked' } }],
  nextCursor: null,
};

function filteredResponse(exposure) {
  const wireHeaders = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    Vary: 'Origin, Authorization', 'Content-Length': String(new TextEncoder().encode(JSON.stringify(packet)).length) });
  if (exposure !== undefined) wireHeaders.set('Access-Control-Expose-Headers', exposure);
  const exposed = (wireHeaders.get('Access-Control-Expose-Headers') || '').split(',').map(name => name.trim().toLowerCase());
  // Model only filtered header visibility; this is not a browser/CORS implementation.
  const visibleHeaders = new Headers([...wireHeaders].filter(([name]) =>
    ['content-type', 'cache-control'].includes(name) || exposed.includes(name)));
  const counters = { readers: 0, cancelled: 0 };
  const response = { status: 200, headers: visibleHeaders, body: {
    cancel() { ++counters.cancelled; return Promise.resolve(); },
    getReader() {
      ++counters.readers;
      let done = false;
      return {
        async read() {
          if (done) return { done: true };
          done = true;
          return { done: false, value: new TextEncoder().encode(JSON.stringify(packet)) };
        },
        cancel() { ++counters.cancelled; return Promise.resolve(); },
        releaseLock() {},
      };
    },
  } };
  return { wireHeaders, response, counters };
}

function fixture(responses) {
  const calls = [], states = [], writes = [];
  const auth = JSON.stringify({ accessToken: 'synthetic.catalog.cors', user: { id: ownerId } });
  const window = { localStorage: {
    getItem: () => auth,
    setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args), clear: () => writes.push('clear'),
  }, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ window, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout });
  vm.runInContext(transportSource, context);
  vm.runInContext(catalogSource, context);
  const transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog({
    storage: window.localStorage, eventTarget: window,
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, 'https://api.lumina-stage.com/api/v1/me/creator-studio/approved-reading-catalog?locale=en&limit=12');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');
      const next = responses.shift();
      assert(next, 'No retries, bootstrap or additional request expected');
      return next.response;
    },
  });
  const controller = window.LuminaCreatorApprovedReadingCatalog.create({ transport, locale: () => 'en',
    onChange: state => states.push(state) });
  return { controller, calls, states, writes, dispose() { controller.dispose(); transport.dispose(); } };
}

for (const exposure of [undefined, 'Content-Length']) {
  test(`wire Vary with ${exposure === undefined ? 'no' : 'unrelated'} exposure clears selection without reading private JSON`, async () => {
    const hidden = filteredResponse(exposure);
    assert.equal(hidden.wireHeaders.get('Vary'), 'Origin, Authorization');
    assert.equal(hidden.response.headers.get('Vary'), null);
    const f = fixture([filteredResponse('Vary'), hidden]);
    try {
      assert.equal(await f.controller.load(), true);
      assert.equal(f.controller.choose(workId), true);
      const selected = f.controller.selection();
      assert(selected);
      assert.equal(await f.controller.load(), false);
      assert.equal(f.states.at(-1).phase, 'unavailable');
      assert.equal(f.states.at(-1).items.length, 0);
      assert.equal(f.controller.selection(), null);
      assert.equal(f.controller.isSelectionCurrent(selected), false);
      assert.equal(f.controller.choose(workId), false);
      assert.equal(hidden.counters.readers, 0);
      assert.equal(hidden.counters.cancelled, 1);
      assert.equal(f.calls.length, 2);
      assert.equal(f.writes.length, 0);
    } finally { f.dispose(); }
  });
}

test('explicit case-insensitive Vary exposure makes the original readonly catalog contract selectable', async () => {
  const exposed = filteredResponse('VaRy');
  assert.equal(exposed.response.headers.get('vary'), 'Origin, Authorization');
  const f = fixture([exposed]);
  try {
    assert.equal(await f.controller.load(), true);
    assert.equal(f.states.at(-1).phase, 'ready');
    assert.equal(f.controller.choose(workId), true);
    assert.equal(f.controller.selection().ownerId, ownerId);
    assert.equal(f.controller.selection().workId, workId);
    assert.equal(exposed.counters.readers, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

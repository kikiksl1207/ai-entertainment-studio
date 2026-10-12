import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const authSource = app.slice(app.indexOf('const API_BASE ='), app.indexOf('const I18N_LOCALES ='));
const walletSource = app.slice(app.indexOf('let _wallet = null;'), app.indexOf('function formatLuminaAmount('));
const authA = { accessToken: 'synthetic-a', refreshToken: 'synthetic-refresh-a', user: { id: 'synthetic-user-a' } };
const authB = { accessToken: 'synthetic-b', refreshToken: 'synthetic-refresh-b', user: { id: 'synthetic-user-b' } };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const values = new Map([['lumina_auth', JSON.stringify(authA)]]), listeners = new Map(), requests = [], rendered = [];
  const context = { AbortController, Event, setTimeout: () => 1, clearTimeout() {}, console: { warn() {}, info() {} },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    window: { addEventListener: (name, callback) => { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
      dispatchEvent: event => { for (const callback of listeners.get(event.type) || []) callback(event); } },
    updateWalletUI: () => rendered.push(runInNewContext('JSON.stringify(_wallet)', context)) };
  runInNewContext(authSource, context);
  context.apiFetch = (route, options) => { const pending = deferred(); requests.push({ route, options, pending }); return pending.promise; };
  runInNewContext(walletSource, context);
  const wallet = () => JSON.parse(runInNewContext('JSON.stringify(_wallet)', context));
  return { context, values, requests, rendered, wallet, load: () => context.loadWallet() };
}
test('normal wallet read uses the real authenticated route and current response', async () => {
  const h = harness(), pending = h.load();
  assert.equal(h.requests[0].route, '/api/v1/wallet');
  assert.equal(h.requests[0].options.auth, true); assert.equal(h.requests[0].options.throwOnError, true);
  h.requests[0].pending.resolve({ cachedBalance: '120.50', currencyCode: 'LUMINA' }); await pending;
  assert.deepEqual(h.wallet(), { balance: 120.5, currencyCode: 'LUMINA', loaded: true });
});
test('old successful response cannot replace the new account balance', async () => {
  const h = harness(), old = h.load(); h.context.setAuth(authB); const current = h.load();
  h.requests[1].pending.resolve({ cachedBalance: '25.00' }); await current;
  h.requests[0].pending.resolve({ cachedBalance: '900.00' }); await old;
  assert.equal(h.wallet().balance, 25);
});
test('old failed response cannot zero the new account balance', async () => {
  const h = harness(), old = h.load(); h.context.setAuth(authB); const current = h.load();
  h.requests[1].pending.resolve({ cachedBalance: '25.00' }); await current;
  h.requests[0].pending.reject(new Error('Synthetic old account failure')); await old;
  assert.equal(h.wallet().balance, 25);
});
test('logout clears a rendered balance immediately, without waiting for another request', async () => {
  const h = harness(), pending = h.load(); h.requests[0].pending.resolve({ balance: '50' }); await pending;
  h.context.clearAuth(); assert.equal(h.wallet(), null); assert.equal(h.requests.length, 1);
  assert.equal(h.rendered.at(-1), 'null');
});
test('an old response cannot restore the balance after logout', async () => {
  const h = harness(), pending = h.load(); h.context.clearAuth();
  h.requests[0].pending.resolve({ balance: '50' }); await pending; assert.equal(h.wallet(), null);
});
test('same-user logout/re-login is a different wallet session', async () => {
  const h = harness(), old = h.load(); h.context.clearAuth();
  h.context.setAuth({ ...authA, accessToken: 'synthetic-a-new-login', refreshToken: 'synthetic-a-new-refresh' });
  h.requests[0].pending.resolve({ balance: '50' }); await old; assert.equal(h.wallet(), null);
});
test('cross-tab auth replacement hides the previous account balance without automatic writes', async () => {
  const h = harness(), pending = h.load(); h.requests[0].pending.resolve({ balance: '50' }); await pending;
  h.values.set('lumina_auth', JSON.stringify(authB)); h.context.window.dispatchEvent({ type: 'storage', key: 'lumina_auth' });
  assert.equal(h.wallet(), null); assert.equal(h.requests.length, 1);
});
test('unrelated storage events do not discard the current wallet', async () => {
  const h = harness(), pending = h.load(); h.requests[0].pending.resolve({ balance: '50' }); await pending;
  h.context.window.dispatchEvent({ type: 'storage', key: 'lumina_locale' }); assert.equal(h.wallet().balance, 50);
});
for (const failed of [false, true]) {
  test(`an older same-session ${failed ? 'failure' : 'success'} cannot replace a later confirmed refresh`, async () => {
    const h = harness(), old = h.load(), current = h.load();
    h.requests[1].pending.resolve({ balance: '60' }); await current;
    if (failed) h.requests[0].pending.reject(new Error('Synthetic older request failure'));
    else h.requests[0].pending.resolve({ balance: '50' });
    await old; assert.equal(h.wallet().balance, 60);
  });
}
test('legitimate same-session token rotation preserves the pending wallet read', async () => {
  const h = harness(), pending = h.load();
  const rotated = { ...authA, accessToken: 'synthetic-a-rotated', refreshToken: 'synthetic-a-refresh-rotated' };
  h.context.rotated = rotated;
  runInNewContext('_refreshCompleted = { session: authRequestSession(), auth: rotated }; setAuth(rotated);', h.context);
  h.requests[0].pending.resolve({ balance: '70' }); await pending; assert.equal(h.wallet().balance, 70);
});
for (const pendingRead of [false, true]) {
  test(`two legitimate token rotations preserve the ${pendingRead ? 'pending read' : 'rendered balance'}`, async () => {
    const h = harness(), pending = h.load();
    if (!pendingRead) { h.requests[0].pending.resolve({ balance: '70' }); await pending; }
    for (let n = 1; n <= 2; n++) {
      h.context.rotated = { ...authA, accessToken: `synthetic-rotation-${n}`, refreshToken: `synthetic-refresh-${n}` };
      runInNewContext('_refreshCompleted = { session: authRequestSession(), auth: rotated }; setAuth(rotated);', h.context);
    }
    if (pendingRead) { h.requests[0].pending.resolve({ balance: '70' }); await pending; }
    assert.equal(h.wallet()?.balance, 70); assert.equal(h.requests.length, 1);
  });
}

test('an invalidated header removes the previous balance from its hidden DOM', () => {
  const badge = { innerHTML: '900 L', style: { display: '' } };
  const source = app.slice(app.indexOf('function updateWalletUI()'), app.indexOf('function getLikesCount('));
  runInNewContext(`${source}\nupdateWalletUI();`, { _wallet: null, document: { getElementById: () => badge } });
  assert.equal(badge.innerHTML, ''); assert.equal(badge.style.display, 'none');
});

test('a current-session failure retains the existing zero-balance display policy', async () => {
  const h = harness(), pending = h.load(); h.requests[0].pending.reject(new Error('Synthetic current failure')); await pending;
  assert.deepEqual(h.wallet(), { balance: null, currencyCode: 'LUMINA', loaded: false });
});

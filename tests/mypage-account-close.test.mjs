import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../assets/js/mypage-account-close.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const authSource = app.slice(app.indexOf('const API_BASE ='), app.indexOf('const I18N_LOCALES ='));
const logoutSource = app.slice(app.indexOf('async function authLogout()'), app.indexOf('function applyAuthResponse('));
const authA = { accessToken: 'test-a', refreshToken: 'test-refresh-a', user: { id: 'test-user-a', hasPassword: true, isSocialOnly: false, providers: ['email'] } };
const authB = { accessToken: 'test-b', refreshToken: 'test-refresh-b', user: { ...authA.user, id: 'test-user-b' } };
const rotatedA = { ...authA, accessToken: 'test-a-rotated', refreshToken: 'test-refresh-rotated' };
const deleted = { ok: true, user: { id: authA.user.id, status: 'deleted' }, revokedSessionCount: 1 };
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// This fixed DOM double checks behavior only, not browser rendering or mobile layout.
class Element {
  constructor(document) {
    this.document = document;
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = { overflow: '' };
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatchEvent(event) {
    return Promise.all((this.listeners.get(event.type) || []).map(listener => listener(event)));
  }
  emit(type, extra = {}) {
    const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    return this.dispatchEvent(event);
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  focus() { this.document.activeElement = this; }
  appendChild(child) { this.child = child; }
  set innerHTML(value) {
    this.markup = value;
    this.children = new Map();
    for (const match of value.matchAll(/id="([^"]+)"/g)) this.children.set(match[1], new Element(this.document));
    this.dismiss = [new Element(this.document), new Element(this.document)];
  }
  querySelector(selector) { return this.children.get(selector.slice(1)); }
  querySelectorAll() { return this.dismiss; }
}

function harness({ auth = authA, confirm = true, fetcher, locale = 'ko' } = {}) {
  const document = { activeElement: null, createElement() { return new Element(document); } };
  document.body = new Element(document);
  document.body.style.overflow = 'auto';
  const button = new Element(document);
  const window = new Element(document);
  const values = new Map(auth ? [['lumina_auth', JSON.stringify(auth)]] : []);
  const writes = [];
  const logs = [];
  const alerts = [];
  const confirmations = [];
  const requests = [];
  let useLocale = locale;
  window.luminaI18n = { getLocale: () => useLocale };
  window.alert = value => alerts.push(value);
  window.confirm = value => { confirmations.push(value); return confirm; };
  const context = createContext({
    document, window, AbortController, Event,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: () => 1, clearTimeout() {},
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
      removeItem: key => { writes.push([key, null]); values.delete(key); }
    },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, ...options });
      return fetcher ? fetcher(path, options) : response(200, path === '/api/v1/me' ? deleted : {});
    },
    updateAuthUI() {}, initMypagePage() {}
  });
  runInContext(authSource, context);
  runInContext(logoutSource, context);
  runInContext(source.replace('export function bindMypageAccountClose', 'function bindMypageAccountClose'), context);
  const bodies = [];
  context.bindMypageAccountClose({
    button, getAuth: () => context.getAuth(), sessionKey: context.authRequestSession,
    sessionCurrent: context.authRequestSessionCurrent,
    request: (path, options) => { bodies.push(options.body); return context.apiFetch(path, options); },
    logout: context.authLogout, getBalance: () => '25'
  });
  const dialog = document.body.child;
  const find = id => dialog.querySelector(`#mypageAccountClose${id}`);
  return {
    context, document, window, button, dialog, password: find('Password'), form: find('Form'), submit: find('Submit'), message: find('Message'),
    alerts, confirmations, requests, bodies, writes, logs,
    async open() { await button.emit('click'); },
    send(value) { if (value !== undefined) find('Password').value = value; return find('Form').emit('submit'); },
    changeAuth(value, notify = true) {
      if (notify) context.setAuth(value);
      else if (value) values.set('lumina_auth', JSON.stringify(value));
      else values.delete('lumina_auth');
    },
    async changeLocale(value) { useLocale = value; await window.emit('lumina:localechange'); }
  };
}

test('HTML wires account closure to the existing request, session and logout helpers', () => {
  const start = html.indexOf('          const accountCloseButton = $("mypageDeleteAccountButton");');
  const end = html.indexOf('\n        }\n\n        let mypageInlineRefreshPromise', start);
  assert.ok(start > 0 && end > start, 'Account closure binding must exist in mypage HTML');
  const binding = html.slice(start, end);
  assert.match(binding, /import\("\/assets\/js\/mypage-account-close\.js"\)/);
  assert.match(binding, /getAuth: \(\) => getAuth\(\)/);
  assert.match(binding, /sessionKey: auth => authRequestSession\(auth\)/);
  assert.match(binding, /sessionCurrent: session => authRequestSessionCurrent\(session\)/);
  assert.match(binding, /request: \(path, options\) => apiFetch\(path, options\)/);
  assert.match(binding, /logout: \(\) => authLogout\(\)/);
  assert.match(source, /type="password" autocomplete="current-password" required maxlength="128"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
});

test('public-site manifest publishes /assets/js/mypage-account-close.js', () => {
  const manifest = JSON.parse(readFileSync(new URL('../scripts/public-site-manifest.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(manifest.files), 'Public-site manifest must have a files allowlist');
  assert.ok(manifest.files.includes('assets/js/mypage-account-close.js'),
    'Public-site manifest must publish /assets/js/mypage-account-close.js');
});

test('all inline HTML scripts and module binding are syntactically valid without execution', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  new Script(source.replace('export function bindMypageAccountClose', 'function bindMypageAccountClose'));
});

test('confirmation, exact untrimmed password DELETE, verified success and existing logout', async () => {
  const h = harness();
  await h.open();
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0], /25L/);
  assert.equal(h.dialog.hidden, false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.document.activeElement, h.password);
  await h.send(' valid-test-password ');
  const deletion = h.requests[0];
  assert.equal(deletion.path, '/api/v1/me');
  assert.equal(deletion.method, 'DELETE');
  assert.equal(deletion.headers.Authorization, 'Bearer test-a');
  assert.deepEqual(JSON.parse(deletion.body), { currentPassword: ' valid-test-password ' });
  assert.equal(h.requests[1].path, '/api/v1/auth/logout');
  assert.equal(h.context.getAuth(), null);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.password.value, '');
  assert.equal(h.bodies[0].currentPassword, '');
  assert.equal(h.document.body.style.overflow, 'auto');
  assert.equal(h.alerts.length, 1);
  assert.equal(JSON.stringify([h.writes, h.logs]).includes('valid-test-password'), false);
});

test('declining explicit confirmation never opens or sends', async () => {
  const h = harness({ confirm: false });
  await h.open();
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.password.value, '');
  assert.equal(h.requests.length, 0);
});

for (const [name, user] of [
  ['social-only', { ...authA.user, isSocialOnly: true, hasPassword: false, providers: ['google'] }],
  ['no-password', { ...authA.user, hasPassword: false }],
  ['unknown-password', { id: authA.user.id, providers: ['email'] }],
  ['non-email-password', { ...authA.user, providers: ['google'] }]
]) {
  test(`${name} is blocked without DELETE, password setup or social reauthentication`, async () => {
    const h = harness({ auth: { ...authA, user } });
    await h.open();
    assert.equal(h.dialog.hidden, true);
    assert.equal(h.requests.length, 0);
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.alerts.length, 1);
  });
}

test('guest cannot use a displayed fixture as account authorization', async () => {
  const h = harness({ auth: null });
  await h.open();
  assert.equal(h.requests.length, 0);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.alerts.length, 1);
});

for (const [name, value] of [['empty', ''], ['overlong', 'x'.repeat(129)]]) {
  test(`${name} input is cleared, rejected locally and can be retried`, async () => {
    const h = harness();
    await h.open();
    await h.send(value);
    assert.equal(h.requests.length, 0);
    assert.equal(h.password.value, '');
    assert.equal(h.message.hidden, false);
    assert.equal(h.submit.disabled, false);
    await h.send('x'.repeat(128));
    assert.equal(h.context.getAuth(), null);
  });
}

test('duplicate clicks and submissions while pending make only one DELETE', async () => {
  const deletion = deferred();
  const h = harness({ fetcher: path => path === '/api/v1/me' ? deletion.promise : response(200) });
  await h.open();
  const first = h.send('duplicate-test-password');
  assert.equal(h.password.value, '');
  assert.equal(h.submit.disabled, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.form.attributes.get('aria-busy'), 'true');
  assert.equal(h.document.activeElement, h.dialog.querySelector('#mypageAccountCloseCard'));
  await h.dialog.emit('keydown', { key: 'Tab' });
  assert.equal(h.document.activeElement, h.dialog.querySelector('#mypageAccountCloseCard'));
  await h.send();
  await h.open();
  await h.dialog.dismiss[1].emit('click');
  await h.dialog.emit('keydown', { key: 'Escape' });
  assert.equal(h.dialog.hidden, false);
  assert.equal(h.requests.length, 1);
  deletion.resolve(response(200, deleted));
  await first;
  assert.equal(h.requests.filter(item => item.method === 'DELETE').length, 1);
});

for (const update of ['metadata', 'rotated-tokens']) {
  for (const outcome of ['success', 'failure', 'transport']) {
    test(`same-user storage ${update} keeps DELETE locked until ${outcome} settles`, async () => {
      const deletion = deferred();
      let deleteCount = 0;
      const h = harness({ fetcher: path => {
        assert.equal(path, '/api/v1/me');
        deleteCount += 1;
        return deleteCount === 1 ? deletion.promise : response(500);
      } });
      await h.open();
      const sending = h.send('first-storage-test-password');
      const updatedAuth = update === 'metadata'
        ? { ...authA, user: { ...authA.user, displayName: 'Synthetic metadata update' } }
        : rotatedA;
      h.changeAuth(updatedAuth, false);
      await h.window.emit('storage', { key: 'lumina_auth' });
      await h.window.emit('storage', { key: 'lumina_auth' });
      assert.equal(h.dialog.hidden, true);
      assert.equal(h.password.value, '');
      assert.equal(h.button.disabled, true);
      await h.open();
      await h.send();
      assert.equal(deleteCount, 1);
      assert.equal(h.requests.length, 1);
      assert.equal(h.confirmations.length, 1);
      if (outcome === 'transport') deletion.reject(new Error('synthetic transport failure'));
      else deletion.resolve(response(outcome === 'success' ? 200 : 500, deleted));
      await sending;
      assert.equal(h.context.getAuth().accessToken, updatedAuth.accessToken);
      assert.equal(h.alerts.length, 0);
      assert.equal(h.dialog.hidden, true);
      assert.equal(h.button.disabled, false);
      assert.equal(h.bodies[0].currentPassword, '');
      await h.open();
      await h.send('fresh-storage-test-password');
      assert.equal(deleteCount, 2);
      assert.equal(h.requests.length, 2);
      assert.deepEqual(JSON.parse(h.requests[1].body), { currentPassword: 'fresh-storage-test-password' });
      assert.equal(h.password.value, '');
    });
  }
}

test('returning to the same user with a new login keeps that user locked until the old DELETE settles', async () => {
  const deletion = deferred();
  let deleteCount = 0;
  const h = harness({ fetcher: path => {
    assert.equal(path, '/api/v1/me');
    deleteCount += 1;
    return deleteCount === 1 ? deletion.promise : response(500);
  } });
  await h.open();
  const sending = h.send('old-login-test-password');
  h.changeAuth(authB);
  assert.equal(h.button.disabled, false);
  await h.open();
  h.password.value = 'other-user-unsent-test-password';
  h.changeAuth(null);
  const newAuthA = { ...authA, accessToken: 'test-returned-a', refreshToken: 'test-returned-refresh-a' };
  h.changeAuth(newAuthA);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.password.value, '');
  assert.equal(h.button.disabled, true);
  await h.open();
  await h.send();
  assert.equal(deleteCount, 1);
  deletion.resolve(response(200, deleted));
  await sending;
  assert.equal(h.context.getAuth().accessToken, newAuthA.accessToken);
  assert.equal(h.alerts.length, 0);
  assert.equal(h.button.disabled, false);
  await h.open();
  await h.send('returned-user-fresh-test-password');
  assert.equal(deleteCount, 2);
  assert.equal(h.requests[1].headers.Authorization, 'Bearer test-returned-a');
});

test('different users have independent DELETE locks and an old settlement cannot unlock the new pending form', async () => {
  const first = deferred();
  const second = deferred();
  const h = harness({ fetcher: (path, options) => {
    if (path !== '/api/v1/me') return response(200);
    return options.headers.Authorization === 'Bearer test-a' ? first.promise : second.promise;
  } });
  await h.open();
  const firstSending = h.send('first-user-test-password');
  h.changeAuth(authB);
  assert.equal(h.button.disabled, false);
  await h.open();
  const secondSending = h.send('second-user-test-password');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].headers.Authorization, 'Bearer test-b');
  first.resolve(response(200, deleted));
  await firstSending;
  assert.equal(h.context.getAuth().accessToken, authB.accessToken);
  assert.equal(h.dialog.hidden, false);
  assert.equal(h.form.attributes.get('aria-busy'), 'true');
  assert.equal(h.submit.disabled, true);
  assert.equal(h.button.disabled, true);
  assert.equal(h.alerts.length, 0);
  await h.open();
  await h.send();
  assert.equal(h.requests.length, 2);
  second.resolve(response(200, { ok: true, user: { id: authB.user.id, status: 'deleted' } }));
  await secondSending;
  assert.equal(h.context.getAuth(), null);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.button.disabled, false);
  assert.equal(h.alerts.length, 1);
});

for (const status of [400, 401, 403, 429, 500, 'transport']) {
  test(`${status} failure clears the password, hides raw errors and permits fresh-input retry`, async () => {
    let fail = true;
    const h = harness({ fetcher: path => {
      if (path === '/api/v1/auth/refresh') return response(200, rotatedA);
      if (path !== '/api/v1/me') return response(200);
      if (!fail) return response(200, deleted);
      if (status === 'transport') return Promise.reject(new Error('do-not-display-test-password'));
      return response(status, { message: 'do-not-display-test-password' });
    } });
    await h.open();
    await h.send('do-not-display-test-password');
    assert.equal(h.password.value, '');
    assert.equal(h.bodies[0].currentPassword, '');
    assert.equal(h.submit.disabled, false);
    assert.equal(h.dialog.hidden, false);
    assert.equal(h.message.hidden, false);
    assert.equal(h.message.textContent.includes('do-not-display-test-password'), false);
    assert.equal(h.requests.some(item => item.path === '/api/v1/auth/logout'), false);
    assert.equal(JSON.stringify([h.writes, h.logs]).includes('do-not-display-test-password'), false);
    const beforeEmptyRetry = h.requests.length;
    await h.send();
    assert.equal(h.requests.length, beforeEmptyRetry);
    fail = false;
    await h.send('fresh-test-password');
    assert.equal(h.context.getAuth(), null);
  });
}

for (const body of [null, {}, { ok: false }, { ok: true }, { ok: true, user: { id: authA.user.id, status: 'active' } }, { ok: true, user: { id: authB.user.id, status: 'deleted' } }]) {
  test(`unverified response ${JSON.stringify(body)} never claims success or logs out`, async () => {
    const h = harness({ fetcher: () => response(200, body) });
    await h.open();
    await h.send('unverified-test-password');
    assert.equal(h.context.getAuth().user.id, authA.user.id);
    assert.equal(h.requests.length, 1);
    assert.equal(h.alerts.length, 0);
    assert.equal(h.password.value, '');
    assert.equal(h.message.hidden, false);
    assert.equal(h.submit.disabled, false);
  });
}

for (const action of ['cancel', 'escape', 'backdrop', 'authchange', 'storage', 'storage-clear', 'pagehide']) {
  test(`${action} scrubs the field and invalidates the confirmation`, async () => {
    const h = harness();
    await h.open();
    h.password.value = 'cancel-test-password';
    if (action === 'cancel') await h.dialog.dismiss[1].emit('click');
    if (action === 'escape') await h.dialog.emit('keydown', { key: 'Escape' });
    if (action === 'backdrop') await h.dialog.emit('click');
    if (action === 'authchange') h.changeAuth(authB);
    if (action === 'storage') await h.window.emit('storage', { key: 'lumina_auth' });
    if (action === 'storage-clear') await h.window.emit('storage', { key: null });
    if (action === 'pagehide') await h.window.emit('pagehide');
    assert.equal(h.password.value, '');
    assert.equal(h.dialog.hidden, true);
    await h.send();
    assert.equal(h.requests.length, 0);
    assert.equal(h.document.body.style.overflow, 'auto');
  });
}

test('silent account replacement is detected before submitting any password', async () => {
  const h = harness();
  await h.open();
  h.changeAuth(authB, false);
  await h.send('old-test-password');
  assert.equal(h.requests.length, 0);
  assert.equal(h.password.value, '');
  assert.equal(h.dialog.hidden, true);
});

for (const outcome of ['success', '401', 'transport']) {
  for (const account of ['different', 'same-user-new-login', 'silent']) {
    test(`late ${outcome} from old account preserves ${account} login`, async () => {
      const deletion = deferred();
      const h = harness({ fetcher: () => deletion.promise });
      await h.open();
      const sending = h.send('late-test-password');
      const nextAuth = account === 'same-user-new-login' ? { ...authA, accessToken: 'test-relogin', refreshToken: 'test-relogin-refresh' } : authB;
      if (account === 'same-user-new-login') h.changeAuth(null);
      h.changeAuth(nextAuth, account !== 'silent');
      if (outcome === 'transport') deletion.reject(new Error('late transport'));
      else deletion.resolve(response(outcome === '401' ? 401 : 200, deleted));
      await sending;
      assert.equal(h.context.getAuth().accessToken, nextAuth.accessToken);
      assert.equal(h.requests.length, 1);
      assert.equal(h.alerts.length, 0);
      assert.equal(h.dialog.hidden, true);
      assert.equal(h.password.value, '');
      assert.equal(h.bodies[0].currentPassword, '');
    });
  }
}

test('old response cannot erase a newly opened account form', async () => {
  const deletion = deferred();
  const h = harness({ fetcher: () => deletion.promise });
  await h.open();
  const sending = h.send('old-test-password');
  h.changeAuth(authB);
  await h.open();
  h.password.value = 'new-unsent-test-password';
  deletion.resolve(response(200, deleted));
  await sending;
  assert.equal(h.password.value, 'new-unsent-test-password');
  assert.equal(h.dialog.hidden, false);
  assert.equal(h.submit.disabled, false);
  assert.equal(h.alerts.length, 0);
});

test('normal apiFetch refresh can retry the same DELETE and reach existing logout', async () => {
  const h = harness({ fetcher: (path, options) => {
    if (path === '/api/v1/auth/refresh') return response(200, rotatedA);
    if (path !== '/api/v1/me') return response(200);
    return options.headers.Authorization === 'Bearer test-a-rotated' ? response(200, deleted) : response(401);
  } });
  await h.open();
  await h.send('rotation-test-password');
  assert.deepEqual(h.requests.map(item => item.path), ['/api/v1/me', '/api/v1/auth/refresh', '/api/v1/me', '/api/v1/auth/logout']);
  assert.equal(h.requests[2].body, h.requests[0].body);
  assert.equal(h.context.getAuth(), null);
  assert.equal(h.dialog.hidden, true);
});

for (const sameUser of [false, true]) {
  test(`late existing logout preserves a new ${sameUser ? 'same-user' : 'different-user'} login`, async () => {
    const logout = deferred();
    const started = deferred();
    const h = harness({ fetcher: path => {
      if (path === '/api/v1/me') return response(200, deleted);
      started.resolve();
      return logout.promise;
    } });
    await h.open();
    const sending = h.send('logout-test-password');
    await started.promise;
    const newAuth = sameUser ? { ...authA, accessToken: 'test-new-session', refreshToken: 'test-new-refresh' } : authB;
    h.changeAuth(newAuth);
    const alertsBefore = h.alerts.length;
    logout.resolve(response(200));
    await sending;
    assert.equal(h.context.getAuth().accessToken, newAuth.accessToken);
    assert.equal(h.alerts.length, alertsBefore);
  });
}

test('revoked refresh after successful deletion still uses existing logout cleanup', async () => {
  const h = harness({ fetcher: path => path === '/api/v1/me' ? response(200, deleted) : response(401) });
  await h.open();
  await h.send('revoked-test-password');
  assert.equal(h.context.getAuth(), null);
  assert.equal(h.dialog.hidden, true);
  assert.equal(h.alerts.length, 1);
});

test('five existing locales update labels and errors without retaining passwords or changing settings', async () => {
  const h = harness();
  const titles = { ko: '회원 탈퇴', en: 'Close account', ja: '退会', 'zh-Hans': '注销账号', 'zh-Hant': '註銷帳號' };
  await h.open();
  await h.send();
  const errors = new Set();
  for (const [locale, title] of Object.entries(titles)) {
    await h.changeLocale(locale);
    assert.equal(h.button.textContent, title);
    assert.equal(h.submit.textContent, title);
    assert.ok(h.message.textContent);
    errors.add(h.message.textContent);
    assert.equal(h.password.value, '');
  }
  assert.equal(errors.size, 5);
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});

test('dialog focus wraps, restores on cancel and unrelated storage changes do not clear it', async () => {
  const h = harness();
  await h.open();
  h.dialog.dismiss[1].focus();
  await h.dialog.emit('keydown', { key: 'Tab' });
  assert.equal(h.document.activeElement, h.dialog.dismiss[0]);
  await h.dialog.emit('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(h.document.activeElement, h.dialog.dismiss[1]);
  h.password.value = 'unsent-test-password';
  await h.window.emit('storage', { key: 'lumina_locale' });
  assert.equal(h.password.value, 'unsent-test-password');
  await h.dialog.dismiss[1].emit('click');
  assert.equal(h.document.activeElement, h.button);
  assert.equal(h.password.value, '');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('app.js', root), 'utf8');
const backstage = readFileSync(new URL('backstage.js', root), 'utf8');

for (const page of ['verify-email', 'reset-password']) {
  test(`${page} removes the action token before loading external assets`, () => {
    const html = readFileSync(new URL(`${page}/index.html`, root), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const script = head.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.ok(head.indexOf('<meta name="referrer" content="no-referrer"') < head.indexOf('href="/styles.css"'));
    assert.ok(head.indexOf('<script>') < head.indexOf('googletagmanager.com'));

    const location = {
      pathname: `/${page}/`,
      search: '?token=private-token&fixture=expired',
      hash: ''
    };
    let replaced;
    const context = {
      window: {},
      location,
      history: { replaceState(_state, _title, url) { replaced = url; } },
      URLSearchParams
    };
    vm.runInNewContext(script, context);
    assert.equal(replaced, `/${page}?fixture=expired`);
    assert.equal(context.window[page === 'verify-email' ? '__luminaVerifyToken' : '__luminaResetToken'], 'private-token');
    assert.doesNotMatch(replaced, /private-token/);
  });
}

test('forgot-password request reports transport failures instead of delivery', () => {
  const handler = app.slice(app.indexOf('async function handleForgotPasswordSubmit('), app.indexOf('async function handleResendVerification('));
  assert.match(handler, /throwOnError:\s*true/);
  assert.match(handler, /err\?\.status === 429/);
  assert.doesNotMatch(handler.slice(handler.indexOf('} catch (err)')), /infoEl\.textContent = neutralMsg/);
  assert.match(app, /window\.location\.hash === "#forgot"[\s\S]*openAuthModal\(tab\)/);
});

test('both Google SDK loaders clear rejected state for another attempt', () => {
  const publicLoader = app.slice(app.indexOf('function loadGoogleSDK()'), app.indexOf('function initGoogleAuth()'));
  const adminLoader = backstage.slice(backstage.indexOf('function loadGoogleSDK()'), backstage.indexOf('function initGoogleAuth()'));
  assert.match(publicLoader, /_googleSdkPromise = null;[\s\S]*googleGsiSdk/);
  assert.match(adminLoader, /googleSdkPromise = null;[\s\S]*googleGsiSdk/);
});

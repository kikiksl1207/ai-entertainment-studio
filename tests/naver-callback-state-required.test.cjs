'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const sourcePath = path.join(ROOT, 'app.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const opening = sha(fs.readFileSync(sourcePath));
const selfOpening = sha(fs.readFileSync(__filename));
const tree = ts.createSourceFile(sourcePath, fs.readFileSync(sourcePath, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) &&
  node.name?.text === 'handleNaverCallback');
assert.equal(functions.length, 1);
assert.equal(functions[0].parameters.length, 0);
assert.ok(functions[0].modifiers?.some(node => node.kind === ts.SyntaxKind.AsyncKeyword));
const genuine = '(' + functions[0].getText(tree) + ')';

async function observe(savedState, returnedState) {
  const storage = new Map([['oauth_provider', 'naver']]);
  if (savedState !== null) storage.set('naver_oauth_state', savedState);
  const params = new URLSearchParams({ access_token: 'synthetic-upstream-access' });
  if (returnedState !== null) params.set('state', returnedState);
  const calls = { api: [], apply: [], alerts: [], removed: [], history: 0, capture: 0, current: 0 };
  const session = Object.freeze({ synthetic: 'unchanged-session' });
  const packet = Object.freeze({ synthetic: 'backend-response' });
  const context = {
    URLSearchParams,
    sessionStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { calls.removed.push(key); storage.delete(key); },
    },
    window: { location: { hash: '#' + params.toString(), pathname: '/synthetic-login-callback' } },
    history: { replaceState(_state, title, pathname) {
      assert.equal(title, '');
      assert.equal(pathname, '/synthetic-login-callback');
      calls.history++;
    } },
    console: { info() {}, warn() {}, error() {} },
    alert(message) { calls.alerts.push(message); },
    authRequestSession() { calls.capture++; return session; },
    authRequestSessionCurrent(value) { calls.current++; assert.equal(value, session); return true; },
    async apiFetch(route, options) {
      calls.api.push({ route, options: JSON.parse(JSON.stringify(options)) });
      return packet;
    },
    applyAuthResponse(data, name) { assert.equal(data, packet); calls.apply.push(name); return true; },
  };
  const callback = vm.runInNewContext(genuine, context, { filename: 'genuine-naver-callback.js',
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  await callback();
  assert.deepEqual(calls.removed, ['naver_oauth_state', 'oauth_provider']);
  assert.equal(calls.history, 1);
  assert.equal(storage.has('naver_oauth_state'), false);
  assert.equal(storage.has('oauth_provider'), false);
  return calls;
}
function rejected(calls) {
  assert.equal(calls.api.length, 0, 'An unbound callback must not exchange an upstream credential');
  assert.equal(calls.apply.length, 0);
  assert.equal(calls.capture, 0);
  assert.equal(calls.current, 0);
  assert.deepEqual(calls.alerts, ['\uB124\uC774\uBC84 \uB85C\uADF8\uC778 \uBCF4\uC548 \uAC80\uC99D \uC2E4\uD328']);
}

test('Naver callback state: absent and empty saved nonce stop before backend exchange', async () => {
  for (const saved of [null, '']) rejected(await observe(saved, 'synthetic-matching-state'));
});

test('Naver callback state: absent empty and mismatching returned nonce remain rejected', async () => {
  for (const returned of [null, '', 'synthetic-different-state']) {
    rejected(await observe('synthetic-matching-state', returned));
  }
});

test('Naver callback state: matching nonce preserves the existing exchange and currentness fence', async () => {
  const calls = await observe('synthetic-matching-state', 'synthetic-matching-state');
  assert.deepEqual(calls.api, [{ route: '/api/v1/auth/social/login', options: {
    method: 'POST', body: { provider: 'naver', token: 'synthetic-upstream-access' }, throwOnError: true,
  } }]);
  assert.deepEqual(calls.apply, ['Naver']);
  assert.equal(calls.capture, 1);
  assert.equal(calls.current, 1);
  assert.deepEqual(calls.alerts, []);
});

process.once('exit', () => {
  assert.equal(sha(fs.readFileSync(sourcePath)), opening);
  assert.equal(sha(fs.readFileSync(__filename)), selfOpening);
});

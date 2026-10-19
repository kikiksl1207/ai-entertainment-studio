'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'app.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const opening = sha(fs.readFileSync(file));
const selfOpening = sha(fs.readFileSync(__filename));
const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
const matches = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleNaverLogin');
assert.equal(matches.length, 1);
assert.equal(matches[0].parameters.length, 0);
assert.ok(matches[0].modifiers?.some(node => node.kind === ts.SyntaxKind.AsyncKeyword));
const genuine = '(' + matches[0].getText(tree) + ')';
const expectedState = '000102030405060708090a0b0c0d0e0f';

async function observe(kind, configured = true, failWrite = 0) {
  const calls = { crypto: 0, math: 0, writes: [], navigations: [], alerts: [], console: [] };
  const storage = new Map();
  const cryptoApi = { getRandomValues(bytes) {
    calls.crypto++;
    assert.equal(this, cryptoApi);
    assert.equal(bytes instanceof Uint8Array, true);
    assert.equal(bytes.byteLength, 16);
    if (kind === 'throw') throw new Error('SYNTHETIC_PRIVATE_FAILURE');
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    return bytes;
  } };
  const location = { origin: 'https://synthetic.example.test' };
  Object.defineProperty(location, 'href', { set(value) { calls.navigations.push(value); } });
  const context = {
    Uint8Array, encodeURIComponent,
    NAVER_CLIENT_ID: configured ? 'synthetic-public-client' : '',
    Math: { random() { calls.math++; return 0; } },
    sessionStorage: { setItem(key, value) {
      calls.writes.push([key, value]);
      if (calls.writes.length === failWrite) throw new Error('SYNTHETIC_STORAGE_FAILURE');
      storage.set(key, value);
    } },
    window: { location, crypto: kind === 'absent' ? undefined : kind === 'noncallable' ? { getRandomValues: 1 } : cryptoApi },
    alert(value) { calls.alerts.push(value); },
    console: Object.fromEntries(['info', 'warn', 'error'].map(method => [method, (...args) => calls.console.push(args)])),
  };
  const callback = vm.runInNewContext(genuine, context, { timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false } });
  if (failWrite) await assert.rejects(callback(), { message: 'SYNTHETIC_STORAGE_FAILURE' });
  else await callback();
  assert.equal(JSON.stringify(calls).includes('SYNTHETIC_PRIVATE_FAILURE'), false);
  return { calls, storage };
}

function stopped(calls) {
  assert.equal(calls.math, 0);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.navigations.length, 0);
  assert.equal(calls.alerts.length, 1);
  assert.equal(typeof calls.alerts[0], 'string');
  assert.ok(calls.alerts[0].length > 0 && calls.alerts[0].length <= 160);
}

test('Naver state preparation uses every Web Crypto byte before binding and navigation', async () => {
  const { calls, storage } = await observe('normal');
  assert.equal(calls.crypto, 1);
  assert.equal(calls.math, 0);
  assert.deepEqual(calls.writes, [['naver_oauth_state', expectedState], ['oauth_provider', 'naver']]);
  assert.equal(storage.get('naver_oauth_state'), expectedState);
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.navigations.length, 1);
  const url = new URL(calls.navigations[0]);
  assert.equal(url.origin, 'https://nid.naver.com');
  assert.equal(url.pathname, '/oauth2.0/authorize');
  assert.deepEqual([...url.searchParams], [['response_type', 'token'], ['client_id', 'synthetic-public-client'],
    ['redirect_uri', 'https://synthetic.example.test'], ['state', expectedState]]);
  assert.equal(url.username + url.password + url.hash, '');
});

test('Naver state preparation stops without a callable secure random source', async () => {
  for (const kind of ['absent', 'noncallable']) {
    const { calls } = await observe(kind);
    stopped(calls);
    assert.equal(calls.crypto, 0);
  }
});

test('Naver state preparation failure never falls back or exposes its exception', async () => {
  const { calls } = await observe('throw');
  stopped(calls);
  assert.equal(calls.crypto, 1);
});

test('Naver state preparation keeps unconfigured and storage failures away from redirect', async () => {
  const unconfigured = await observe('normal', false);
  stopped(unconfigured.calls);
  assert.equal(unconfigured.calls.crypto, 0);
  for (const failWrite of [1, 2]) {
    const { calls, storage } = await observe('normal', true, failWrite);
    assert.equal(calls.writes.length, failWrite);
    assert.equal(calls.navigations.length, 0);
    assert.equal(calls.alerts.length, 0);
    assert.equal(storage.size, failWrite - 1);
  }
});

process.once('exit', () => {
  assert.equal(sha(fs.readFileSync(file)), opening);
  assert.equal(sha(fs.readFileSync(__filename)), selfOpening);
});

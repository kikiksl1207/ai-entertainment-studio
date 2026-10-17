import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');

const functionNames = [
  'authRequestSession', 'authRequestSessionCurrent', 'apiFetch', 'getAuth',
  'setAuth', 'getRefreshToken', 'authLogin', 'handleAuthSubmit',
  'normalizedAuthPublicErrorCopy', 'getAuthSubmitErrorMessage', 'isReferralCodeError',
];
const constantNames = [
  'API_BASE', 'AUTH_STORAGE_KEY', 'AUTH_REFERRAL_CODE_ERROR_MESSAGE', 'AUTH_PUBLIC_ERROR_COPY',
];

// Exact function from published 32796cf; UTF-8, LF, no trailing newline.
const legacyAuthLogin = [
  'async function authLogin(email, password) {',
  '  const data = await apiFetch("/api/v1/auth/login", {',
  '    method: "POST",',
  '    body: { email, password },',
  '    throwOnError: true',
  '  });',
  '  // \uc751\ub2f5: { user, tokens: { accessToken, refreshToken } } \ub610\ub294 \ud638\ud658 \ubcc4\uce6d (top-level)',
  '  const token = data?.accessToken || data?.tokens?.accessToken || data?.access_token;',
  '  const refresh = data?.refreshToken || data?.tokens?.refreshToken;',
  '  const user = data?.user;',
  '  console.info("[Lumina] login \uc751\ub2f5 \uc218\uc2e0", {',
  '    hasUser: Boolean(user),',
  '    hasAccessToken: Boolean(token),',
  '    hasRefreshToken: Boolean(refresh)',
  '  });',
  '  if (token) setAuth({ accessToken: token, refreshToken: refresh, user });',
  '  return data;',
  '}',
].join('\n');
const legacySha256 = '0003e51a076405f8826bbe5a1813b0ca744919d9cb0b7fc02d9d296083c26254';

const scenarios = [
  { name: 'email-valid-top-level-replaces-old-canonical', group: 'valid aliases', valid: true, shape: 'top' },
  { name: 'email-valid-nested-alias-replaces-old-canonical', group: 'valid aliases', valid: true, shape: 'nested' },
  { name: 'email-valid-snake-alias-replaces-old-canonical', group: 'valid aliases', valid: true, shape: 'snake' },
  { name: 'email-valid-top-level-priority-unchanged', group: 'valid aliases', valid: true, shape: 'priority' },
  { name: 'email-204-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, status: 204, shape: 'null' },
  { name: 'email-json-null-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'null' },
  { name: 'email-missing-object-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'empty' },
  { name: 'email-missing-nested-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'empty-nested' },
  { name: 'email-numeric-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'numeric' },
  { name: 'email-object-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'object' },
  { name: 'email-empty-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'empty-token' },
  { name: 'email-whitespace-token-preserves-old-and-keeps-form', group: 'invalid success responses', legacy: true, shape: 'whitespace' },
  { name: 'email-server-error-preserves-old-and-keeps-form', group: 'existing failure paths', status: 401, shape: 'server-error' },
  { name: 'email-storage-failure-preserves-old-and-keeps-form', group: 'existing failure paths', shape: 'top', storageFailure: true },
];

function extractDeclarations(source, names) {
  const file = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'production source must parse');
  const wanted = new Set(names);
  const found = new Map();
  for (const node of file.statements) {
    const declaredNames = ts.isFunctionDeclaration(node) && node.name
      ? [node.name.text]
      : ts.isVariableStatement(node)
        ? node.declarationList.declarations.map(item => ts.isIdentifier(item.name) ? item.name.text : '')
        : [];
    for (const name of declaredNames) {
      if (!wanted.has(name)) continue;
      assert.equal(found.has(name), false, `duplicate production declaration: ${name}`);
      found.set(name, node.getText(file));
    }
  }
  for (const name of wanted) assert.equal(found.has(name), true, `missing production declaration: ${name}`);
  return found;
}

let currentProgram;
let legacyProgram;
before(() => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const declarations = extractDeclarations(source, [...functionNames, ...constantNames]);
  currentProgram = [...new Set(declarations.values())].join('\n');
  assert.equal(createHash('sha256').update(legacyAuthLogin, 'utf8').digest('hex'), legacySha256);
  const historical = extractDeclarations(legacyAuthLogin, ['authLogin']);
  assert.equal(historical.get('authLogin'), legacyAuthLogin);
  legacyProgram = [...new Set([...declarations].map(([name, text]) =>
    name === 'authLogin' ? historical.get('authLogin') : text))].join('\n');
});

function responseFixture(shape) {
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const tokens = { accessToken: 'new.synthetic.token', refreshToken: 'new.synthetic.refresh' };
  switch (shape) {
    case 'top': return { user, ...tokens };
    case 'nested': return { user, tokens };
    case 'snake': return { user, access_token: tokens.accessToken, refreshToken: tokens.refreshToken };
    case 'priority': return { user, ...tokens, tokens: { accessToken: 'lower.priority.synthetic' } };
    case 'null': return null;
    case 'empty': return {};
    case 'empty-nested': return { user, tokens: {} };
    case 'numeric': return { user, accessToken: 7 };
    case 'object': return { user, accessToken: {} };
    case 'empty-token': return { user, accessToken: '' };
    case 'whitespace': return { user, accessToken: '   ' };
    case 'server-error': return { code: 'AUTH_INVALID_CREDENTIALS' };
    default: throw new Error('Unknown synthetic fixture');
  }
}

async function exercise(production, scenario) {
  const initial = JSON.stringify({
    accessToken: 'old.synthetic.token', refreshToken: 'old.synthetic.refresh',
    user: { id: '11111111-1111-4111-8111-111111111111' },
    tokens: { accessToken: 'old.lower.priority.synthetic' },
  });
  let stored = initial;
  const count = { json: 0, writeAttempts: 0, writes: 0, removes: 0,
    authEvents: 0, closed: 0, updated: 0, mypage: 0, returned: 0, resets: 0, forbidden: 0 };
  const requests = [];
  const error = { hidden: true, textContent: '' };
  const submit = { disabled: false, textContent: 'synthetic-submit' };
  const copyKeys = [];
  const form = {
    email: { value: 'fixture@example.invalid' }, password: { value: 'synthetic-only' },
    querySelector(selector) {
      if (selector === '[data-error]') return error;
      if (selector === '.auth-modal-submit') return submit;
      throw new Error('Unexpected synthetic form selector');
    },
    reset() { ++count.resets; },
  };
  const forbid = () => { ++count.forbidden; throw new Error('Forbidden synthetic operation'); };
  const context = createContext({
    AbortController, setTimeout, clearTimeout,
    console: { info() {}, error() {}, warn() {}, log() {} },
    Event: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem(key) { assert.equal(key, 'lumina_auth'); return stored; },
      setItem(key, value) {
        assert.equal(key, 'lumina_auth'); ++count.writeAttempts;
        if (scenario.storageFailure) throw new Error('Synthetic storage failure');
        stored = value; ++count.writes;
      },
      removeItem() { ++count.removes; return forbid(); },
    },
    window: { dispatchEvent(event) { assert.equal(event.type, 'lumina:authchange'); ++count.authEvents; } },
    async fetch(url, options) {
      requests.push({ url, options });
      const status = scenario.status || 200;
      return { status, ok: status >= 200 && status < 300, async json() {
        ++count.json; return responseFixture(scenario.shape);
      } };
    },
    refreshAuthOnce: forbid, authLogout: forbid, authRegister: forbid,
    closeAuthModal() { ++count.closed; }, updateAuthUI() { ++count.updated; },
    initMypagePage() { ++count.mypage; }, completeAuthReturnIntent() { ++count.returned; },
    authModalCopy(key) { copyKeys.push(key); return 'synthetic-localized-login-failed'; },
    translateValidationError: forbid,
    __form: form,
  });
  runInContext('let _refreshCompleted = null; let _authReturnIntent = null;\n' + production,
    context, { timeout: 2000 });
  await runInContext("handleAuthSubmit(__form, 'login')", context, { timeout: 2000 });
  const current = context.getAuth();
  // Check dispatch outside production's error catch, so a harness failure cannot look like a login rejection.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.lumina-stage.com/api/v1/auth/login');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(requests[0].options.body).email, 'fixture@example.invalid');
  assert.equal(count.json, scenario.status === 204 ? 0 : 1);
  assert.equal(count.forbidden, 0);
  assert.equal(count.removes, 0);
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'synthetic-submit');
  return { count, current, initial, stored, error, copyKeys };
}

function verifyDesiredOutcome(observed, scenario) {
  const { count, current, initial, stored, error, copyKeys } = observed;
  const success = scenario.valid === true;
  assert.equal(count.writeAttempts, success || scenario.storageFailure ? 1 : 0);
  assert.equal(count.writes, success ? 1 : 0);
  assert.equal(count.authEvents, success ? 1 : 0);
  for (const name of ['closed', 'updated', 'mypage', 'returned', 'resets']) {
    assert.equal(count[name], success ? 1 : 0);
  }
  assert.equal(error.hidden, success);
  if (success) {
    assert.deepEqual(copyKeys, []);
    assert.equal(current.accessToken, 'new.synthetic.token');
    assert.equal(current.refreshToken, 'new.synthetic.refresh');
    assert.equal(current.user.id, '11111111-1111-4111-8111-111111111111');
    assert.equal(Object.hasOwn(current, 'tokens'), false);
  } else {
    assert.deepEqual(copyKeys, ['loginFailed']);
    assert.equal(error.textContent, 'synthetic-localized-login-failed');
    assert.equal(error.textContent.includes('Login response is missing'), false);
    assert.equal(stored, initial);
    assert.equal(current.accessToken, 'old.synthetic.token');
  }
}

function verifyLegacyWitness(observed, scenario) {
  const { count, current, initial, stored, error, copyKeys } = observed;
  const wroteUnsupported = ['numeric', 'object', 'whitespace'].includes(scenario.shape);
  assert.equal(count.writeAttempts, wroteUnsupported ? 1 : 0);
  assert.equal(count.writes, wroteUnsupported ? 1 : 0);
  assert.equal(count.authEvents, wroteUnsupported ? 1 : 0);
  for (const name of ['closed', 'updated', 'mypage', 'returned', 'resets']) {
    assert.equal(count[name], 1);
  }
  assert.equal(error.hidden, true);
  assert.deepEqual(copyKeys, []);
  if (wroteUnsupported) {
    assert.notEqual(stored, initial);
    assert.equal(JSON.stringify(current.accessToken), JSON.stringify(responseFixture(scenario.shape).accessToken));
  } else {
    assert.equal(stored, initial);
    assert.equal(current.accessToken, 'old.synthetic.token');
  }
}

describe('portable email-login fail-closed integration', { concurrency: false }, () => {
  for (const group of ['valid aliases', 'invalid success responses', 'existing failure paths']) {
    describe(group, { concurrency: false }, () => {
      for (const scenario of scenarios.filter(item => item.group === group)) {
        it(scenario.name, async () => {
          verifyDesiredOutcome(await exercise(currentProgram, scenario), scenario);
          if (scenario.legacy) {
            verifyLegacyWitness(await exercise(legacyProgram, scenario), scenario);
          }
        });
      }
    });
  }
});

'use strict';
// Portable CI admission; actual middleware modules and in-memory protocol fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { before, test } = require('node:test');

const CURRENT = { size: 582, sha: 'cda4020e8d861a6cab45bce3c1e902de66f3e13e14a22601028188551dc8ca4b' };
const ORIGINAL = { size: 470, sha: 'ce8ee28f87220ab6cae9c496dffe79c5a0d98099072685a3558d66a0c99d9b9d' };
const PARSER = { size: 9112572, sha: '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675' };
const PRIVACY = 'private, no-store';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const norm = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
let programs;
const ORIGINAL_SOURCE = String.raw`// Set this before parsing and authentication, including rejected private requests.
export function settingsPrivacyMiddleware(
  request: { method?: string; url: string },
  response: { setHeader(name: string, value: string): void },
  next: () => void,
) {
  if (['GET', 'HEAD', 'PATCH'].includes(request.method ?? '') &&
    /^\/api\/(?:v1\/)?me\/settings\/?(?:\?|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
`;

function pinned(file, pin, canonicalSource = false) {
  assert.equal(path.isAbsolute(file), true, 'INPUT_ABSOLUTE');
  const real = fs.realpathSync.native(file);
  assert.equal(norm(real), norm(file), 'INPUT_EXACT_REALPATH');
  const stat = fs.statSync(real);
  assert.equal(stat.isFile() && stat.size > 0 && stat.size <= pin.size * (canonicalSource ? 2 : 1),
    true, 'INPUT_BOUNDED_REGULAR_SIZE');
  const raw = fs.readFileSync(real);
  assert.equal(raw.length, stat.size, 'INPUT_READ_SIZE');
  let bytes = raw;
  if (canonicalSource) {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    assert.equal(text.startsWith('\uFEFF'), false, 'INPUT_NO_BOM');
    assert.equal(Buffer.from(text, 'utf8').equals(raw), true, 'INPUT_UTF8_ROUNDTRIP');
    const remainder = text.replace(/\r\n/g, '');
    assert.equal(remainder.includes('\r'), false, 'INPUT_NO_BARE_CR');
    assert.equal(text.includes('\r\n') && remainder.includes('\n'), false, 'INPUT_UNIFORM_EOL');
    bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  }
  assert.equal(bytes.length, pin.size, 'INPUT_EXACT_SIZE');
  assert.equal(sha(bytes), pin.sha, 'INPUT_EXACT_SHA256');
  return { real, bytes };
}

function compileActual(ts, source) {
  const parsed = ts.createSourceFile('auth-settings.privacy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(parsed.parseDiagnostics.length, 0, 'ACTUAL_MODULE_PARSE_CLEAN');
  assert.equal(parsed.statements.length, 1, 'ACTUAL_MODULE_ONE_DECLARATION');
  const fn = parsed.statements[0];
  assert.equal(ts.isFunctionDeclaration(fn) && fn.name?.text === 'settingsPrivacyMiddleware' && Boolean(fn.body),
    true, 'ACTUAL_EXPORTED_MIDDLEWARE');
  assert.equal(fn.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword), true, 'ACTUAL_EXPORT');
  const emitted = ts.transpileModule(source, { fileName: 'auth-settings.privacy.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed } });
  assert.equal((emitted.diagnostics || []).length, 0, 'ACTUAL_MODULE_SYNTAX_EMIT_CLEAN');
  const exports = {};
  const context = vm.createContext({ exports });
  new vm.Script(emitted.outputText, { filename: 'actual-privacy-module.cjs' }).runInContext(context, { timeout: 2000 });
  assert.deepEqual(Object.keys(exports), ['settingsPrivacyMiddleware'], 'ACTUAL_EXACT_EXPORTS');
  assert.equal(typeof exports.settingsPrivacyMiddleware, 'function', 'ACTUAL_MIDDLEWARE_FUNCTION');
  return exports.settingsPrivacyMiddleware;
}

before(() => {
  assert.equal(process.argv.length, 2, 'INPUT_FILENAME_ONLY');
  assert.equal(typeof process.argv[1], 'string', 'INPUT_FILENAME_REQUIRED');
  assert.equal(norm(process.argv[1]), norm(__filename), 'INPUT_EXACT_TEST_FILENAME');
  assert.equal(norm(fs.realpathSync.native(__filename)), norm(__filename), 'INPUT_TEST_REALPATH');
  assert.equal(Buffer.byteLength(ORIGINAL_SOURCE), ORIGINAL.size, 'ORIGINAL_EXACT_SOURCE_BYTES');
  assert.equal(sha(Buffer.from(ORIGINAL_SOURCE)), ORIGINAL.sha, 'ORIGINAL_EXACT_SOURCE_SHA256');
  const current = pinned(path.resolve(__dirname, '../server/src/auth/auth-settings.privacy.ts'), CURRENT, true);
  const parser = pinned(path.resolve(__dirname, '../server/node_modules/typescript/lib/typescript.js'), PARSER);
  const ts = require(parser.real);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(current.bytes);
  programs = Object.freeze({ candidate: compileActual(ts, source), original: compileActual(ts, ORIGINAL_SOURCE) });
});

function invoke(state, mode, method, url, nextError = null) {
  assert.equal(Object.hasOwn(programs, mode), true, 'FIXTURE_EXPLICIT_PROGRAM');
  state[mode + 'Calls']++;
  const events = [], headers = new Map();
  const request = Object.freeze(method === undefined ? { url } : { method, url });
  let nextCalls = 0, headerAtNext = null, thrown = null, returned;
  const check = value => {
    if (!value) { state.fixtureFaults++; throw new Error('PRIVACY_FIXTURE_CONTRACT'); }
  };
  const response = { statusCode: 200, setHeader(name, value) {
    check(name === 'Cache-Control' && value === PRIVACY && !headers.has(name));
    headers.set(name, value); events.push('header');
  } };
  const next = () => {
    nextCalls++; check(nextCalls === 1);
    headerAtNext = headers.get('Cache-Control') ?? null;
    events.push('next'); response.statusCode = 401; events.push('fake-401');
    if (nextError !== null) throw nextError;
  };
  try { returned = programs[mode](request, response, next); } catch (error) { thrown = error; }
  return { events, headers, request, response, nextCalls, headerAtNext, thrown, returned };
}

function verify(state, result, privacy, expectedError = null) {
  state.headerChecks++;
  assert.equal(result.nextCalls, 1, 'NEXT_EXACTLY_ONCE');
  assert.equal(result.response.statusCode, 401, 'SYNTHETIC_AUTH_CONTINUATION');
  assert.equal(result.returned, undefined, 'MIDDLEWARE_VOID_RESULT');
  assert.equal(result.thrown, expectedError, 'EXACT_NEXT_THROW_OR_NORMAL_COMPLETION');
  assert.equal(result.headerAtNext, privacy ? PRIVACY : null, 'HEADER_BEFORE_AUTH_CONTINUATION');
  assert.equal(result.headers.get('Cache-Control') ?? null, privacy ? PRIVACY : null, 'HEADER_REMAINS_AFTER_NEXT');
  assert.equal(result.headers.size, privacy ? 1 : 0, 'ONLY_EXPECTED_HEADER');
  assert.deepEqual(result.events, privacy ? ['header', 'next', 'fake-401'] : ['next', 'fake-401'],
    'EXACT_HEADER_AUTH_ORDER');
}

function group(name, label, callback) {
  test(name, () => {
    const state = { candidateCalls: 0, originalCalls: 0, headerChecks: 0,
      semanticOriginalWitness: false, fixtureFaults: 0 };
    try { callback(state); assert.equal(state.fixtureFaults, 0, 'STICKY_FIXTURE_FAULT'); }
    finally { console.log(JSON.stringify({ contract: 'auth-me-read-privacy-v1', case: label,
      candidateCalls: state.candidateCalls, originalCalls: state.originalCalls, headerChecks: state.headerChecks,
      semanticOriginalWitness: state.semanticOriginalWitness, fixtureFaults: state.fixtureFaults })); }
  });
}

group('auth me privacy: GET sets private no-store before a synthetic 401', 'get-before-401', state => {
  const current = invoke(state, 'candidate', 'GET', '/api/v1/me');
  const old = invoke(state, 'original', 'GET', '/api/v1/me');
  verify(state, current, true); verify(state, old, false);
  state.semanticOriginalWitness = old.headerAtNext === null && old.headers.size === 0 &&
    old.thrown === null && old.nextCalls === 1 && old.response.statusCode === 401;
  assert.equal(state.semanticOriginalWitness, true, 'AUTH_ME_GET_ORIGINAL_NO_PRIVACY');
});

group('auth me privacy: HEAD sets private no-store before a synthetic 401', 'head-before-401', state => {
  const current = invoke(state, 'candidate', 'HEAD', '/api/v1/me');
  const old = invoke(state, 'original', 'HEAD', '/api/v1/me');
  verify(state, current, true); verify(state, old, false);
  state.semanticOriginalWitness = old.headerAtNext === null && old.headers.size === 0 &&
    old.thrown === null && old.nextCalls === 1 && old.response.statusCode === 401;
  assert.equal(state.semanticOriginalWitness, true, 'AUTH_ME_HEAD_ORIGINAL_NO_PRIVACY');
});

group('auth me privacy: settings and non-target route-method matrix stay unchanged', 'route-method-matrix', state => {
  const rows = [];
  for (const method of ['GET', 'HEAD', 'PATCH']) for (const url of [
    '/api/v1/me/settings', '/api/v1/me/settings/', '/api/v1/me/settings?locale=ko',
    '/api/v1/me/settings/?x=1', '/api/me/settings', '/api/me/settings/',
    '/api/me/settings?x=1', '/API/V1/ME/SETTINGS',
  ]) rows.push({ method, url, original: true, candidate: true });
  for (const method of ['GET', 'HEAD']) for (const url of [
    '/api/v1/me/', '/api/v1/me?x=1', '/api/v1/me/?x=1', '/API/V1/ME',
  ]) rows.push({ method, url, original: false, candidate: true });
  for (const method of [undefined, '', 'get', 'head', 'patch', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    for (const url of ['/api/v1/me', '/api/v1/me/settings']) rows.push({ method, url, original: false, candidate: false });
  }
  rows.push({ method: 'PATCH', url: '/api/v1/me', original: false, candidate: false });
  for (const url of [
    '/api/me', '/me', '/api/v10/me', '/api/v1/mee', '/api/v1/me/profile', '/api/v1/me//',
    '//api/v1/me', 'https://example.invalid/api/v1/me', '/api/v1/me#login', '/api/v1/%6de',
    '/api/v1/me%2f', '/api/v1/me;param', '/api/v1/me/settingsx', '/api/v1/me/settings/child',
    '/api/v1/me/settings//', '', '/api/v1/me\rx', '/api/v1/me/settings\rx', ' /api/v1/me', '/?next=/api/v1/me',
  ]) for (const method of ['GET', 'HEAD', 'PATCH']) rows.push({ method, url, original: false, candidate: false });
  assert.equal(rows.length, 111, 'EXACT_FINITE_MATRIX');
  for (const row of rows) for (const mode of ['candidate', 'original']) {
    verify(state, invoke(state, mode, row.method, row.url), row[mode]);
  }
});

group('auth me privacy: independent calls invoke next once and preserve thrown identity', 'next-once-and-throw', state => {
  const first = invoke(state, 'candidate', 'GET', '/api/v1/me');
  const second = invoke(state, 'candidate', 'GET', '/api/v1/me');
  verify(state, first, true); verify(state, second, true);
  assert.notEqual(first.headers, second.headers, 'INDEPENDENT_RESPONSE_HEADER_MAPS');
  assert.notEqual(first.response, second.response, 'INDEPENDENT_RESPONSE_OBJECTS');
  assert.notEqual(first.request, second.request, 'INDEPENDENT_REQUEST_OBJECTS');
  first.headers.set('Cache-Control', 'synthetic-response-only-change');
  assert.equal(second.headers.get('Cache-Control'), PRIVACY, 'NO_CROSS_INVOCATION_HEADER_STATE');
  const sentinel = new Error('SYNTHETIC_NEXT_THROW');
  verify(state, invoke(state, 'candidate', 'HEAD', '/api/v1/me?x=1', sentinel), true, sentinel);
  verify(state, invoke(state, 'candidate', 'PATCH', '/api/v1/me/settings', sentinel), true, sentinel);
  verify(state, invoke(state, 'original', 'PATCH', '/api/v1/me/settings', sentinel), true, sentinel);
  verify(state, invoke(state, 'original', 'GET', '/api/v1/me', sentinel), false, sentinel);
});

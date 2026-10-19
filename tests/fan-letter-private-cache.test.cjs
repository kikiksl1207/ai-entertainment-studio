const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const sourcePath = path.join(ROOT, 'server/src/fan-engagement/fan-engagement.privacy.ts');
const sourceBytes = fs.readFileSync(sourcePath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const openingSha = sha(sourceBytes);
const source = ts.createSourceFile(sourcePath, sourceBytes.toString('utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
assert.equal(source.parseDiagnostics.length, 0);
assert.equal(source.statements.length, 1, 'Load the complete standalone middleware module');
const declaration = source.statements[0];
assert.ok(ts.isFunctionDeclaration(declaration));
assert.equal(declaration.name?.text, 'fanEngagementPrivacyMiddleware');
assert.equal(declaration.parameters.length, 3);
assert.ok(declaration.body);
const compiled = ts.transpileModule(sourceBytes.toString('utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const context = { exports: {} };
vm.runInNewContext(compiled.outputText, context, { filename: 'fan-engagement.privacy.js',
  timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
const middleware = context.exports.fanEngagementPrivacyMiddleware;
assert.equal(typeof middleware, 'function');

const routes = [
  { path: '/api/v1/me/fan-letters/sent', methods: ['GET', 'HEAD'] },
  { path: '/api/v1/me/fan-letters/received', methods: ['GET', 'HEAD'] },
  { path: '/api/v1/fan-letters', methods: ['POST'] },
  { path: '/api/v1/fan-letters/preview', methods: ['POST'] },
  { path: '/api/v1/me/fan-letters/received/not-a-uuid/status', methods: ['PATCH'] },
];
const protectedRequests = routes.flatMap(route => route.methods.map(method => ({ method, path: route.path })));
const variants = pathname => [pathname, `${pathname}/`, pathname.toUpperCase(), `${pathname.toUpperCase()}/`];

function probe(request, withVary = true) {
  const headers = new Map([['Cache-Control', 'public, max-age=60'], ['Vary', 'Origin'], ['X-Unrelated', 'keep']]);
  const events = [];
  const response = { setHeader(name, value) { events.push(['header', name, value]); headers.set(name, value); } };
  if (withVary) response.vary = field => {
    events.push(['vary', field]); headers.set('Vary', `${headers.get('Vary')}, ${field}`);
  };
  return { headers, events, run(downstream = () => {}) {
    return middleware(request, response, () => { events.push(['next']); downstream(); });
  } };
}

function privateOnly(p) {
  assert.equal(p.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(p.headers.get('Vary'), 'Origin');
  assert.equal(p.headers.get('X-Unrelated'), 'keep');
  assert.deepEqual(p.events, [['header', 'Cache-Control', 'private, no-store'], ['next']]);
}

function untouched(method, pathname) {
  const p = probe({ method, path: pathname });
  p.run();
  assert.deepEqual([...p.headers], [['Cache-Control', 'public, max-age=60'], ['Vary', 'Origin'], ['X-Unrelated', 'keep']]);
  assert.deepEqual(p.events, [['next']]);
}

test('fan-letter privacy: protected paths set private no-store before next without Vary', () => {
  for (const request of protectedRequests) for (const pathname of variants(request.path)) {
    const p = probe({ method: request.method, path: pathname }, false);
    p.run(() => assert.equal(p.headers.get('Cache-Control'), 'private, no-store'));
    privateOnly(p);
  }
  const encoded = probe({ method: 'PATCH', path: '/api/v1/me/fan-letters/received/a%2Fb/status' }, false);
  encoded.run();
  privateOnly(encoded);
});

test('fan-letter privacy: public policy, disallowed methods and near paths stay untouched', () => {
  const methods = ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
  for (const route of routes) {
    for (const method of methods.filter(value => !route.methods.includes(value))) untouched(method, route.path);
    for (const method of route.methods) untouched(method.toLowerCase(), route.path);
    untouched(undefined, route.path);
  }
  for (const method of methods) for (const pathname of variants('/api/v1/fan-letters/policy')) untouched(method, pathname);
  const near = [
    ['GET', '/api/v1/me/fan-letters/sent-extra'], ['HEAD', '/api/v1/me/fan-letters/received/extra'],
    ['GET', '/api/v1/me/fan-letters/sent//'], ['GET', '/api/v1/fan-letters/sent'],
    ['GET', '/api/v10/me/fan-letters/sent'], ['GET', '/prefix/api/v1/me/fan-letters/sent'],
    ['POST', '/api/v1/fan-letters-preview'], ['POST', '/api/v1/fan-letters/preview/extra'],
    ['POST', '/api/v1/fan-letters//preview'], ['POST', '/api/v1/fan-letters//'],
    ['PATCH', '/api/v1/me/fan-letters/id/status'],
    ['PATCH', '/api/v1/me/fan-letters/sent/id/status'],
    ['PATCH', '/api/v1/me/fan-letters/received//status'],
    ['PATCH', '/api/v1/me/fan-letters/received/a/b/status'],
    ['PATCH', '/api/v1/me/fan-letters/received/id/status/extra'],
    ['PATCH', '/api/v1/me/fan-letters/received/id/status//'],
  ];
  for (const [method, pathname] of near) untouched(method, pathname);
});

test('fan-letter privacy: the four existing fan-engagement route classes stay unchanged', () => {
  const legacy = [
    ['GET', '/api/v1/me/fan-engagement/summary', false], ['HEAD', '/api/v1/me/fan-engagement/summary', false],
    ['PATCH', '/api/v1/me/fan-engagement/title', false],
    ['GET', '/api/v1/fan-engagement/missions', true], ['HEAD', '/api/v1/fan-engagement/missions', true],
    ['GET', '/api/v1/fan-engagement/concept-votes', true], ['HEAD', '/api/v1/fan-engagement/concept-votes', true],
  ];
  for (const [method, route, vary] of legacy) for (const pathname of variants(route)) {
    const p = probe({ method, path: pathname });
    p.run(() => assert.equal(p.headers.get('Cache-Control'), 'private, no-store'));
    if (!vary) privateOnly(p);
    else {
      assert.deepEqual(p.events, [['header', 'Cache-Control', 'private, no-store'], ['vary', 'Authorization'], ['next']]);
      assert.equal(p.headers.get('Vary'), 'Origin, Authorization');
      assert.equal(p.headers.get('X-Unrelated'), 'keep');
    }
  }
  for (const [pathname, message] of [
    ['/api/v1/fan-engagement/missions', 'Mission-list response requires Vary support'],
    ['/api/v1/fan-engagement/concept-votes', 'Concept-list response requires Vary support'],
  ]) {
    const p = probe({ method: 'GET', path: pathname }, false);
    assert.throws(() => p.run(), error => error.name === 'TypeError' && error.message === message);
    assert.deepEqual(p.events, [['header', 'Cache-Control', 'private, no-store']]);
  }
  untouched('POST', '/api/v1/me/fan-engagement/summary');
  untouched('GET', '/api/v1/me/fan-engagement/title');
  untouched('PATCH', '/api/v1/fan-engagement/missions');
  untouched('GET', '/api/v1/fan-engagement/concept-votes/extra');
});

test('fan-letter privacy: downstream errors retain headers and pathname failure behavior stays unchanged', () => {
  for (const request of protectedRequests) for (const statusCode of [400, 401, 403, 404, 500, 503]) {
    const error = Object.assign(new Error(`downstream-${statusCode}`), { statusCode });
    const p = probe(request, false);
    assert.throws(() => p.run(() => {
      assert.equal(p.headers.get('Cache-Control'), 'private, no-store');
      throw error;
    }), caught => caught === error);
    privateOnly(p);
  }
  const pathError = new Error('pathname unavailable');
  const request = { method: 'GET', get path() { throw pathError; } };
  const p = probe(request);
  p.run();
  assert.deepEqual(p.events, [['next']]);
  assert.equal(p.headers.get('Cache-Control'), 'public, max-age=60');
  const nextError = new Error('downstream failure after pathname fallback');
  const failing = probe(request);
  assert.throws(() => failing.run(() => { throw nextError; }), caught => caught === nextError);
  assert.deepEqual(failing.events, [['next']]);
  assert.equal(failing.headers.get('Cache-Control'), 'public, max-age=60');
});

process.once('exit', () => assert.equal(sha(fs.readFileSync(sourcePath)), openingSha, 'Closing selected middleware source'));

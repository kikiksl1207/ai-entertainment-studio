import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../server/src/chat/story-chat-history.privacy.ts', import.meta.url), 'utf8');
const module = { exports: {} };
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
vm.runInNewContext(compiled.outputText, { exports: module.exports, module });
const { storyChatHistoryPrivacyMiddleware: middleware } = module.exports;

function inspect(method, url) {
  const request = { method, url };
  const headers = new Map();
  let calls = 0;
  middleware(request, { setHeader: (name, value) => headers.set(name, value) }, () => { calls++; });
  assert.equal(calls, 1);
  assert.equal(request.method, method);
  assert.equal(request.url, url);
  return headers;
}

for (const [method, url] of [
  ['GET', '/api/v1/chat/sessions/synthetic/messages'],
  ['GET', '/api/chat/sessions/synthetic/messages?storyProgressId=synthetic'],
  ['HEAD', '/api/v1/chat/sessions/synthetic/messages/'],
  ['GET', '/api/v1/chat/sessions/not-a-uuid/messages'],
  ['get', '/API/V1/CHAT/SESSIONS/synthetic/MESSAGES'],
]) {
  test(`personal history cache boundary: ${method} ${url}`, () => {
    assert.deepEqual([...inspect(method, url)], [['Cache-Control', 'private, no-store']]);
  });
}

test('unrelated reads and writes retain their original headers and request flow', () => {
  for (const [method, url] of [
    ['POST', '/api/v1/chat/sessions/synthetic/messages'],
    ['GET', '/api/v1/artists'],
    ['GET', '/api/v1/chat/sessions/synthetic/generate'],
    ['GET', '/api/v2/chat/sessions/synthetic/messages'],
    ['GET', '/api/v1/chat/sessions/synthetic/messages-other'],
  ]) assert.equal(inspect(method, url).size, 0);
});

test('the native app installs the boundary before route guards and parsers', () => {
  const main = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');
  const middlewareAt = main.indexOf('app.use(storyChatHistoryPrivacyMiddleware);');
  assert(middlewareAt >= 0);
  assert(middlewareAt < main.indexOf('configureHttpRouting(app);'));
  assert(middlewareAt < main.indexOf('app.useGlobalPipes('));
});

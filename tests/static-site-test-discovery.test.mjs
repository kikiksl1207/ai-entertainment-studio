import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'qa-artifacts');
const runner = readFileSync(path.join(root, 'scripts/run-static-site-tests.mjs'));
mkdirSync(artifacts, { recursive: true });

function run(files) {
  const out = mkdtempSync(path.join(artifacts, 'static-discovery-'));
  mkdirSync(path.join(out, 'scripts')); mkdirSync(path.join(out, 'tests'));
  mkdirSync(path.join(out, 'scripts', 'tests'));
  writeFileSync(path.join(out, 'scripts/run-static-site-tests.mjs'), runner);
  for (const [name, content] of Object.entries(files)) {
    assert.equal(path.basename(name), name);
    writeFileSync(path.join(out, 'tests', name), content);
  }
  const env = { NODE_ENV: 'test', CI: 'true' };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH']) if (process.env[key]) env[key] = process.env[key];
  for (const key of ['TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CACHE_HOME']) env[key] = out;
  const result = spawnSync(process.execPath, ['scripts/run-static-site-tests.mjs'], {
    cwd: out, env, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return result;
}

const esm = label => `import test from 'node:test'; test(${JSON.stringify(label)}, () => {});\n`;
const cjs = label => `const test = require('node:test'); test(${JSON.stringify(label)}, () => {});\n`;
const excluded = 'throw new Error("EXCLUDED_TEST_WAS_EXECUTED");\n';

test('STATIC-DISCOVERY: both supported test module formats reach the actual runner', () => {
  const result = run({ 'a.test.mjs': esm('ESM_SELECTED'), 'b.test.cjs': cjs('CJS_SELECTED') });
  assert.equal(result.status, 0); assert.match(result.stdout, /ESM_SELECTED/); assert.match(result.stdout, /CJS_SELECTED/);
  assert.match(result.stdout, /# tests 2\b/); assert.match(result.stdout, /# fail 0\b/);
});

test('STATIC-DISCOVERY: browser and explicit live-page exclusions remain excluded in both formats', () => {
  const result = run({
    'safe.test.cjs': cjs('SAFE_STATIC'), 'one.browser.test.mjs': excluded, 'two.browser.test.cjs': excluded,
    'character-public-pages.test.mjs': excluded, 'story-stage-first-release.test.mjs': excluded,
  });
  assert.equal(result.status, 0); assert.match(result.stdout, /SAFE_STATIC/);
  assert.match(result.stdout, /# tests 1\b/); assert.doesNotMatch(result.stdout + result.stderr, /EXCLUDED_TEST_WAS_EXECUTED/);
});

test('STATIC-DISCOVERY: backups and unrelated extensions are never selected', () => {
  const result = run({ 'safe.test.mjs': esm('SAFE_SUFFIX'),
    'a.test.cjs.txt': excluded, 'b.test.mjs.bak': excluded, 'c.cjs': excluded, 'd.mjs': excluded });
  assert.equal(result.status, 0); assert.match(result.stdout, /# tests 1\b/);
  assert.doesNotMatch(result.stdout + result.stderr, /EXCLUDED_TEST_WAS_EXECUTED/);
});

test('STATIC-DISCOVERY: an empty selection remains a failure', () => {
  const result = run({ 'one.browser.test.cjs': excluded, 'notes.txt': excluded });
  assert.equal(result.status, 1); assert.match(result.stderr, /No static site tests found/);
});

test('STATIC-DISCOVERY: a failing CommonJS test propagates failure to the deployment gate', () => {
  const result = run({ 'failure.test.cjs': "const test = require('node:test'); test('EXPECTED_SYNTHETIC_FAILURE', () => { throw new Error('EXPECTED'); });\n" });
  assert.equal(result.status, 1); assert.match(result.stdout, /EXPECTED_SYNTHETIC_FAILURE/);
  assert.match(result.stdout, /# fail 1\b/);
});

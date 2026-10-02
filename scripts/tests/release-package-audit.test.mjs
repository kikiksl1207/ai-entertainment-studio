import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { comparePackageMetadata } from '../release-package-audit.mjs';

function fixture() {
  const manifest = { dependencies: { '@scope/runtime': '^1.0.0' },
    devDependencies: { typescript: '^5.0.0', prisma: '^6.0.0', '@nestjs/cli': '^10.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': structuredClone(manifest) } };
  const installed = new Map();
  for (const [name, installedVersion] of [['@scope/runtime', '1.2.3'], ['typescript', '5.9.3'], ['prisma', '6.19.3'], ['@nestjs/cli', '10.4.9']]) {
    lock.packages[`node_modules/${name}`] = { version: installedVersion };
    installed.set(name, { name, version: installedVersion });
  }
  return { manifest, lock, installed };
}

test('importing the metadata auditor never loads a nonbuiltin CommonJS package', () => {
  const target = new URL('../release-package-audit.mjs', import.meta.url).href;
  const script = `import Module from 'node:module';
    const original = Module._load;
    const builtins = new Set(Module.builtinModules.map((name) => name.replace(/^node:/, '')));
    Module._load = function(request, ...rest) {
      if (!builtins.has(request.replace(/^node:/, ''))) throw new Error('Unexpected package load');
      return original.call(this, request, ...rest);
    };
    await import(${JSON.stringify(target)});
    process.stdout.write('metadata-only');`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8',
    windowsHide: true, maxBuffer: 4096, env: { SystemRoot: process.env.SystemRoot,
      TEMP: 'E:\\Codex\\LuminaStage\\qa-temp', TMP: 'E:\\Codex\\LuminaStage\\qa-temp' } });
  assert.equal(output, 'metadata-only');
});

test('compares runtime and build tools separately without needing package code', () => {
  const result = comparePackageMetadata(fixture());
  assert.equal(result.directMetadataMatches, true);
  assert.equal(result.records.filter((r) => r.kind === 'runtime').length, 1);
  assert.equal(result.records.filter((r) => r.kind === 'build-tool').length, 3);
});

for (const [state, change] of [
  ['manifest-lock-mismatch', (f) => { f.lock.packages[''].dependencies['@scope/runtime'] = '^2.0.0'; }],
  ['missing', (f) => { f.installed.delete('@scope/runtime'); }],
  ['invalid-lock-entry', (f) => { delete f.lock.packages['node_modules/@scope/runtime']; }],
  ['invalid-lock-entry', (f) => { f.lock.packages['node_modules/@scope/runtime'].link = true; }],
  ['invalid-lock-entry', (f) => { f.lock.packages['node_modules/@scope/runtime'].version = 'not a version'; }],
  ['invalid-installed-metadata', (f) => { f.installed.get('@scope/runtime').name = 'another'; }],
  ['invalid-installed-metadata', (f) => { f.installed.get('@scope/runtime').version = 'private raw string'; }],
  ['installed-version-mismatch', (f) => { f.installed.get('@scope/runtime').version = '1.2.4'; }],
]) {
  test(`preserves the explicit ${state} instead of sample success`, () => {
    const f = fixture();
    change(f);
    const result = comparePackageMetadata(f);
    assert.equal(result.directMetadataMatches, false);
    assert.equal(result.records.find((r) => r.kind === 'runtime').state, state);
    assert.equal(JSON.stringify(result).includes('private raw string'), false);
  });
}

test('extra root runtime dependencies in the lockfile need review', () => {
  const f = fixture();
  f.lock.packages[''].dependencies.extra = '^1.0.0';
  const result = comparePackageMetadata(f);
  assert.equal(result.directMetadataMatches, false);
  assert.deepEqual(result.extraLockedRuntime, ['extra']);
});

test('never prints an invalid extra lock key containing private credentials', () => {
  const f = fixture();
  f.lock.packages[''].dependencies['https://user:private-password@invalid.example/package'] = '^1.0.0';
  assert.throws(() => comparePackageMetadata(f), (error) => {
    assert.equal(error.message.includes('private-password'), false);
    return /Invalid locked runtime package name/.test(error.message);
  });
});

test('metadata equality is not declared range satisfaction', () => {
  const f = fixture();
  f.lock.packages['node_modules/@scope/runtime'].version = '2.0.0';
  f.installed.get('@scope/runtime').version = '2.0.0';
  const result = comparePackageMetadata(f);
  assert.equal(result.directMetadataMatches, true);
  assert.equal(result.versionConstraintsVerified, false);
});

test('does not expose unsupported private URL constraints', () => {
  const f = fixture();
  f.manifest.dependencies['@scope/runtime'] = 'https://user:private-password@invalid.example/package.tgz';
  assert.throws(() => comparePackageMetadata(f), (error) => {
    assert.equal(error.message.includes('private-password'), false);
    return /Invalid direct package/.test(error.message);
  });
});

for (const name of ['../private', 'C:/private', '@scope/../../private', '.env', 'bad\\name']) {
  test(`rejects unsafe package name ${JSON.stringify(name)}`, () => {
    const f = fixture();
    f.manifest.dependencies[name] = '^1.0.0';
    assert.throws(() => comparePackageMetadata(f), /Invalid direct package/);
  });
}

for (const change of [
  (f) => { f.lock.lockfileVersion = 2; },
  (f) => { f.manifest.dependencies = []; },
  (f) => { f.manifest.dependencies = {}; },
  (f) => { delete f.manifest.devDependencies.prisma; },
  (f) => { f.installed = {}; },
]) {
  test('rejects incomplete or unsupported metadata', () => {
    const f = fixture();
    change(f);
    assert.throws(() => comparePackageMetadata(f), /Invalid package|Invalid direct package/);
  });
}

import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { auditLocalBuild, compareBuildOutputs, validateBuildConfiguration } from '../release-build-audit.mjs';

const temp = 'E:\\Codex\\LuminaStage\\qa-temp';
function checkedDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      if (!create) throw new Error('Missing fixture directory');
      mkdirSync(current);
    }
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('Linked fixture directory');
  }
  return absolute;
}
function fixture(t) {
  checkedDirectory(temp, true);
  const root = mkdtempSync(path.join(temp, 'build-audit-'));
  t.after(() => {
    if (!checkedDirectory(root).startsWith(`${checkedDirectory(temp)}${path.sep}`)) throw new Error('Unexpected cleanup path');
    rmSync(root, { recursive: true });
  });
  const put = (file, bytes) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), bytes);
  };
  const outputs = new Map([['server/dist/main.js', Buffer.from('"use strict";\nexports.ok = true;\n')]]);
  put('server/dist/main.js', outputs.get('server/dist/main.js'));
  return { root, outputs, put };
}

test('matches exact JavaScript without executing it or changing its bytes', (t) => {
  const f = fixture(t);
  const result = compareBuildOutputs(f);
  assert.equal(result.localJavaScriptMatches, true);
  assert.equal(result.files[0].state, 'matches');
  assert.match(result.files[0].actualSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(readFileSync(path.join(f.root, 'server/dist/main.js')), f.outputs.get('server/dist/main.js'));
});

test('a missing build is not a successful match', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'server/dist/main.js'));
  const result = compareBuildOutputs(f);
  assert.equal(result.localJavaScriptMatches, false);
  assert.equal(result.files[0].state, 'missing');
  assert.equal(result.files[0].actualSha256, null);
});

test('stale bytes and even line-ending changes are not normalized away', (t) => {
  const f = fixture(t);
  f.put('server/dist/main.js', f.outputs.get('server/dist/main.js').toString().replace(/\n/g, '\r\n'));
  const result = compareBuildOutputs(f);
  assert.equal(result.localJavaScriptMatches, false);
  assert.equal(result.files[0].state, 'changed');
});

test('unreferenced old JavaScript is inventoried rather than silently ignored', (t) => {
  const f = fixture(t);
  f.put('server/dist/old/module.js', 'process.exit(99);');
  const result = compareBuildOutputs(f);
  assert.equal(result.localJavaScriptMatches, false);
  assert.equal(result.extraJavaScript[0].file, 'server/dist/old/module.js');
});

test('inventories uppercase JavaScript extensions on Windows too', (t) => {
  const f = fixture(t);
  f.put('server/dist/old.JS', 'never execute');
  const result = compareBuildOutputs(f);
  assert.equal(result.localJavaScriptMatches, false);
  assert.equal(result.extraJavaScript[0].file, 'server/dist/old.JS');
});

test('rejects an extra module added during compiled content rechecks', (t) => {
  const f = fixture(t);
  let reads = 0;
  f.readBytes = (absolute) => {
    if (++reads === 2) f.put('server/dist/late.js', 'arrived late');
    return readFileSync(absolute);
  };
  assert.throws(() => compareBuildOutputs(f), /Compiled inventory changed/);
});

test('rejects a linked fixture directory before writes or recursive cleanup', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, 'elsewhere'));
  symlinkSync(path.join(f.root, 'elsewhere'), path.join(f.root, 'linked'), 'junction');
  assert.throws(() => checkedDirectory(path.join(f.root, 'linked'), true), /Linked fixture/);
});

test('supports only the explicitly checked repository config chain', () => {
  assert.doesNotThrow(() => validateBuildConfiguration({ extends: './tsconfig.json' }, {}, { sourceRoot: 'src' }));
});

test('uses the actual config and in-memory compiler without replacing a fixture build', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', 'const ok = true;');
  f.put('server/tsconfig.json', JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'ES2021',
    outDir: './dist', strict: true, skipLibCheck: true, types: [] }, include: ['src/**/*.ts'] }));
  f.put('server/tsconfig.build.json', JSON.stringify({ extends: './tsconfig.json', exclude: ['**/*spec.ts'] }));
  f.put('server/nest-cli.json', JSON.stringify({ sourceRoot: 'src' }));
  const expected = Buffer.from('"use strict";\nconst ok = true;\n');
  f.put('server/dist/main.js', expected);
  const result = auditLocalBuild(f.root);
  assert.equal(result.expectedJavaScriptCount, 1);
  assert.equal(result.sourceFiles.length, 4);
  assert.equal(result.localJavaScriptMatches, true);
  assert.equal(result.production, false);
  assert.equal(result.deployment, false);
  assert.equal(result.realAi, false);
  assert.deepEqual(readFileSync(path.join(f.root, 'server/dist/main.js')), expected);
  assert.equal(existsSync(path.join(f.root, 'server/dist/main.js.map')), false);
  assert.equal(existsSync(path.join(f.root, 'server/tsconfig.tsbuildinfo')), false);
});

for (const [build, base, nest] of [
  [{ extends: '../other.json' }, {}, { sourceRoot: 'src' }],
  [{ extends: './tsconfig.json' }, { extends: '../other.json' }, { sourceRoot: 'src' }],
  [{ extends: './tsconfig.json', references: [] }, {}, { sourceRoot: 'src' }],
  [{ extends: './tsconfig.json' }, { references: [] }, { sourceRoot: 'src' }],
  [{ extends: './tsconfig.json' }, {}, { sourceRoot: 'src', compilerOptions: {} }],
  [{ extends: './tsconfig.json' }, {}, { sourceRoot: 'src', projects: {} }],
]) {
  test('rejects untracked config inheritance or a different Nest compiler', () => {
    assert.throws(() => validateBuildConfiguration(build, base, nest), /Unsupported build/);
  });
}

for (const file of ['server/dist/../../outside.js', 'C:/private.js', 'server/dist/.env', 'server/dist/main.js?x',
  'server\\dist\\main.js', '/server/dist/main.js', 'server/dist/secret\0.js']) {
  test(`rejects unsafe output ${JSON.stringify(file)}`, (t) => {
    const f = fixture(t);
    f.outputs = new Map([[file, Buffer.from('never write')]]);
    assert.throws(() => compareBuildOutputs(f), /Invalid expected|Unsafe build/);
  });
}

test('rejects duplicate case-normalized output names', (t) => {
  const f = fixture(t);
  f.outputs.set('server/dist/MAIN.js', Buffer.from('different'));
  assert.throws(() => compareBuildOutputs(f), /Colliding/);
});

test('rejects linked compiled files', (t) => {
  const f = fixture(t);
  f.put('other.js', 'not compiled');
  rmSync(path.join(f.root, 'server/dist/main.js'));
  try {
    symlinkSync(path.join(f.root, 'other.js'), path.join(f.root, 'server/dist/main.js'));
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('Windows does not permit a file symlink in this process; directory junctions are tested separately');
    return;
  }
  assert.throws(() => compareBuildOutputs(f), /Linked/);
});

test('rejects a linked parent of an expected compiled file', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, 'elsewhere'));
  f.put('elsewhere/main.js', f.outputs.get('server/dist/main.js'));
  const dist = path.resolve(f.root, 'server/dist');
  if (!dist.startsWith(`${path.resolve(temp)}${path.sep}`)) throw new Error('Unexpected fixture path');
  rmSync(dist, { recursive: true });
  symlinkSync(path.join(f.root, 'elsewhere'), dist, 'junction');
  assert.throws(() => compareBuildOutputs(f), /Linked/);
});

test('rejects linked extra directories', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, 'elsewhere'));
  symlinkSync(path.join(f.root, 'elsewhere'), path.join(f.root, 'server/dist/linked'), 'junction');
  assert.throws(() => compareBuildOutputs(f), /Linked/);
});

test('detects a compiled file changing while checked', (t) => {
  const f = fixture(t);
  let reads = 0;
  f.readBytes = (absolute) => ++reads === 1 ? readFileSync(absolute) : Buffer.from('changed during audit');
  assert.throws(() => compareBuildOutputs(f), /changed during audit/);
});

test('detects an extra module changing while checked', (t) => {
  const f = fixture(t);
  f.put('server/dist/extra.js', 'first');
  let extras = 0;
  f.readBytes = (absolute) => absolute.endsWith('extra.js') && ++extras > 1 ? Buffer.from('later') : readFileSync(absolute);
  assert.throws(() => compareBuildOutputs(f), /Extra compiled file changed/);
});

test('rejects empty output lists and oversized compiler output', (t) => {
  const f = fixture(t);
  assert.throws(() => compareBuildOutputs({ ...f, outputs: new Map() }), /Invalid build/);
  f.outputs.set('server/dist/too-big.js', Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.throws(() => compareBuildOutputs(f), /Invalid expected/);
});

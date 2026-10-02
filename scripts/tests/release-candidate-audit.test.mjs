import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { auditCandidate, gitReadOptions, readGitSnapshot, validateManifest, writeCandidateReport } from '../release-candidate-audit.mjs';

const temp = 'E:\\Codex\\LuminaStage\\qa-temp';
const commit = 'a'.repeat(40);
function fixture(t) {
  mkdirSync(temp, { recursive: true });
  const root = mkdtempSync(path.join(temp, 'candidate-fixture-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(`${path.resolve(temp)}${path.sep}`)) throw new Error('Unexpected test cleanup path');
    rmSync(root, { recursive: true });
  });
  const source = {
    'server/src/main.ts': "import './app.module'; export * from './policy'; const external = import('node:crypto');",
    'server/src/app.module.ts': "import type { Policy } from './policy'; export class AppModule {}",
    'server/src/policy.ts': 'export type Policy = { ok: boolean };',
    'reader/index.html': '<html><body>Reader</body></html>',
    'pages/reader.js': 'globalThis.Reader = {};',
    'server/prisma/migrations/0001_initial/migration.sql': 'SELECT 1;',
    'server/prisma/migrations/0002_receipts/migration.sql': 'SELECT 2;',
  };
  const put = (file, body) => {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
    source[file] = body;
  };
  for (const [file, body] of Object.entries(source)) put(file, body);
  const manifest = { version: 1, scope: 'Isolated source fixtures', serverEntries: ['server/src/main.ts'],
    groups: [{ id: 'runtime', requires: [], files: ['reader/index.html'], serverFiles: ['server/src/app.module.ts'] },
      { id: 'reader', requires: ['runtime'], files: ['pages/reader.js'], serverFiles: ['server/src/policy.ts'] }],
    migrations: { directory: 'server/prisma/migrations', expectedCount: 2, requiredInOrder: ['0001_initial', '0002_receipts'] } };
  const snapshot = { commit, tracked: new Set(Object.keys(source)), committed: new Set(Object.keys(source)),
    treeEntries: new Map(Object.keys(source).map((file) => [file, { mode: '100644', type: 'blob', oid: 'c'.repeat(40) }])) };
  const committedHashes = (_root, _snapshot, files) => new Map(files.filter((file) => snapshot.committed.has(file)).map((file) => {
    const digest = (body) => createHash('sha256').update(body).digest('hex');
    return [file, { rawSha256: digest(source[file]), normalizedSha256: digest(source[file].replace(/\r\n/g, '\n')) }];
  }));
  return { root, manifest, snapshot, put, source, committedHashes };
}

test('captures the exact bounded source graph, static files and ordered migrations', (t) => {
  const f = fixture(t);
  const result = auditCandidate(f);
  assert.equal(result.inspectedFileCount, 7);
  assert.equal(result.serverDependencyCount, 3);
  assert.equal(result.migrationCount, 2);
  assert.equal(result.gitCandidateMatches, true);
  assert.deepEqual(result.externalImports, ['node:crypto']);
  assert.equal(result.deployment, false);
  assert.equal(result.realAi, false);
  assert.equal(result.limitations.length, 6);
  assert.ok(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

for (const mode of ['untracked', 'absent-from-commit', 'modified']) {
  test(`does not mark a ${mode} local runtime file as committed`, (t) => {
    const f = fixture(t);
    const file = 'server/src/policy.ts';
    if (mode === 'untracked') f.snapshot.tracked.delete(file);
    else if (mode === 'absent-from-commit') f.snapshot.committed.delete(file);
    else f.source[file] += '\n// Previous committed source';
    const result = auditCandidate(f);
    assert.equal(result.sourceInventoryVerified, true);
    assert.equal(result.gitCandidateMatches, false);
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].file, file);
  });
}

for (const file of ['../private.ts', '/private.ts', 'C:/private.ts', 'server\\private.ts', 'server/.env', 'server/secret.env',
  'server/node_modules/secret.js', 'qa-artifacts/secret.json', 'pages/reader.js?old', 'pages/reader.js\0',
  'secrets/provider.json', 'server/Secrets/provider.json', 'server/credentials.json']) {
  test(`rejects an unsafe manifest path: ${JSON.stringify(file)}`, (t) => {
    const f = fixture(t);
    f.manifest.groups[0].files = [file];
    assert.throws(() => auditCandidate(f), /Unsafe candidate path/);
  });
}

for (const mutation of [
  (m) => { m.groups.push(structuredClone(m.groups[0])); },
  (m) => { m.groups[0].files.push(m.groups[0].files[0]); },
  (m) => { m.groups[0].requires = ['unknown']; },
  (m) => { m.groups[0].requires = ['reader']; },
  (m) => { m.serverEntries.push(m.serverEntries[0]); },
  (m) => { m.migrations.directory = '../private'; },
  (m) => { m.migrations.requiredInOrder.push(m.migrations.requiredInOrder[0]); },
  (m) => { m.extraApproval = true; },
]) {
  test('rejects a malformed group or migration manifest', (t) => {
    const f = fixture(t);
    mutation(f.manifest);
    assert.throws(() => validateManifest(f.manifest));
  });
}

test('requires every explicit source file, not a successful empty result', (t) => {
  const f = fixture(t);
  f.manifest.groups[0].files.push('reader/missing.html');
  assert.throws(() => auditCandidate(f), /Missing candidate file/);
});
test('requires declared server services to be reachable from the entry', (t) => {
  const f = fixture(t);
  f.put('server/src/unwired.ts', 'export class Unwired {}');
  f.manifest.groups[0].serverFiles.push('server/src/unwired.ts');
  assert.throws(() => auditCandidate(f), /Unreachable server requirement/);
});
test('requires migration count review and does not silently absorb a new migration', (t) => {
  const f = fixture(t);
  f.put('server/prisma/migrations/0003_new/migration.sql', 'SELECT 3;');
  assert.throws(() => auditCandidate(f), /Migration count changed/);
});
test('requires the exact migration predecessor order', (t) => {
  const f = fixture(t);
  f.manifest.migrations.requiredInOrder.reverse();
  assert.throws(() => auditCandidate(f), /missing or out of order/);
});
test('does not tolerate a migration directory without its SQL', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'server/prisma/migrations/0002_receipts/migration.sql'));
  assert.throws(() => auditCandidate(f), /Missing candidate file/);
});
test('parses reexports and literal dynamic/require imports without execution', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', "export * from './app.module'; const a = import('./policy'); const b = require('./data.json');");
  f.put('server/src/data.json', '{"fixture":true}');
  f.snapshot.tracked.add('server/src/data.json');
  f.snapshot.committed.add('server/src/data.json');
  assert.equal(auditCandidate(f).serverDependencyCount, 4);
});
test('records variable imports as unchecked rather than complete runtime coverage', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', "import './app.module'; import('./policy'); const unknown = require(moduleName);");
  assert.deepEqual(auditCandidate(f).dynamicImportsNeedingReview, [{ file: 'server/src/main.ts', line: 1 }]);
});
test('allows import cycles without infinite traversal', (t) => {
  const f = fixture(t);
  f.put('server/src/policy.ts', "import './main'; export type Policy = {}; ");
  assert.equal(auditCandidate(f).serverDependencyCount, 3);
});
test('rejects an unresolved relative import', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', "import './missing';");
  assert.throws(() => auditCandidate(f), /Unresolved relative import/);
});
test('rejects an escaping relative import before reading outside the repository', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', "import '../../../outside';");
  assert.throws(() => auditCandidate(f), /Unsafe candidate path/);
});
test('rejects broken source syntax before a positive inventory result', (t) => {
  const f = fixture(t);
  f.put('server/src/main.ts', 'export class {');
  assert.throws(() => auditCandidate(f), /Candidate syntax error/);
});
test('detects a source mutation between graph discovery and final fingerprint', (t) => {
  const f = fixture(t);
  let reads = 0;
  const target = path.join(f.root, 'server/src/policy.ts');
  f.readBytes = (file) => file === target && ++reads === 2 ? Buffer.from('export type Policy = { changed: true };') : readFileSync(file);
  assert.throws(() => auditCandidate(f), /Candidate changed during audit/);
});
test('does not read linked source or evidence directories', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.root, 'linked'));
  symlinkSync(path.join(f.root, 'linked'), path.join(f.root, 'alias'), 'junction');
  f.manifest.groups[0].files = ['alias/reader.js'];
  assert.throws(() => auditCandidate(f), /Linked candidate path/);
  symlinkSync(path.join(f.root, 'linked'), path.join(f.root, 'qa-artifacts'), 'junction');
  assert.throws(() => writeCandidateReport(f.root, 'qa-artifacts/result.json', {}), /Linked evidence directory/);
});
test('retains a report without overwriting prior evidence', (t) => {
  const f = fixture(t);
  const report = auditCandidate(f);
  writeCandidateReport(f.root, 'qa-artifacts/result.json', report);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.root, 'qa-artifacts/result.json'), 'utf8')), report);
  assert.throws(() => writeCandidateReport(f.root, 'qa-artifacts/result.json', {}), /EEXIST/);
  assert.throws(() => writeCandidateReport(f.root, '../result.json', {}), /Invalid evidence path/);
});
test('rejects option-like and malformed local ref input before invoking Git', () => {
  assert.throws(() => readGitSnapshot(temp, '--upload-pack=private'), /Invalid local Git reference/);
  assert.throws(() => readGitSnapshot(temp, 'HEAD\nprivate'), /Invalid local Git reference/);
});
test('compares actual committed content even if Git metadata hides the modification', (t) => {
  const f = fixture(t);
  f.source['server/src/policy.ts'] = 'export type Policy = { previous: true };';
  const result = auditCandidate(f);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].modifiedFromCommit, true);
  assert.equal(result.blockers[0].normalizedSourceMatchesCommit, false);
  assert.equal(result.gitCandidateMatches, false);
});
test('preserves raw fingerprints while distinguishing only CRLF/LF differences', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'server/src/policy.ts'), 'export type Policy = { ok: boolean };\r\n');
  f.source['server/src/policy.ts'] = 'export type Policy = { ok: boolean };\n';
  const result = auditCandidate(f);
  const record = result.files.find((file) => file.file === 'server/src/policy.ts');
  assert.equal(record.lineEndingOnlyDifference, true);
  assert.notEqual(record.sha256, record.commitSha256);
  assert.equal(result.gitCandidateMatches, true);
});
test('detects a committed migration missing locally even when local count matches', (t) => {
  const f = fixture(t);
  f.snapshot.committed.add('server/prisma/migrations/0003_old/migration.sql');
  f.snapshot.treeEntries.set('server/prisma/migrations/0003_old/migration.sql', { mode: '100644', type: 'blob', oid: 'c'.repeat(40) });
  const result = auditCandidate(f);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.missingLocalMigrations, ['server/prisma/migrations/0003_old/migration.sql']);
  assert.equal(result.gitCandidateMatches, false);
});
test('does not inherit Git redirection, credential or automatic-fetch settings', () => {
  const options = gitReadOptions(temp, { Path: 'trusted-runtime', SystemRoot: 'Windows', GIT_DIR: 'private',
    GIT_WORK_TREE: 'private', GIT_CONFIG_PARAMETERS: 'private', GIT_SSH_COMMAND: 'private', OPENAI_API_KEY: 'private' });
  assert.equal(options.env.Path, 'trusted-runtime');
  assert.equal(options.env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(options.env.GIT_DIR, undefined);
  assert.equal(options.env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.env.TEMP, temp);
});
test('preserves an old non-UTF8 ref as an explicit mismatch, not an invented conversion', (t) => {
  const f = fixture(t);
  const base = f.committedHashes;
  f.committedHashes = (...args) => {
    const hashes = base(...args);
    hashes.set('server/src/policy.ts', { rawSha256: 'b'.repeat(64), normalizedSha256: null });
    return hashes;
  };
  const result = auditCandidate(f);
  assert.equal(result.gitCandidateMatches, false);
  assert.equal(result.blockers[0].committedEncoding, 'non-utf8-needs-review');
  assert.equal(result.blockers[0].commitSha256, 'b'.repeat(64));
});
test('stops on non-UTF8 current source before certifying its inventory', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'pages/reader.js'), Buffer.from([0xff, 0xfe, 65, 0]));
  assert.throws(() => auditCandidate(f), /Non-UTF8 current candidate: pages\/reader.js/);
});
test('rejects case-folded path aliases instead of flattening two candidate files', (t) => {
  const f = fixture(t);
  f.manifest.groups[1].files.push('pages/Reader.js');
  assert.throws(() => auditCandidate(f), /Colliding candidate path/);
});
test('rejects a committed symlink or submodule in the migration tree', (t) => {
  const f = fixture(t);
  f.snapshot.treeEntries.set('server/prisma/migrations/0003_link/migration.sql', { mode: '120000', type: 'blob', oid: 'c'.repeat(40) });
  f.snapshot.treeEntries.set('server/prisma/migrations/0004_module', { mode: '160000', type: 'commit', oid: 'c'.repeat(40) });
  const result = auditCandidate(f);
  assert.equal(result.gitCandidateMatches, false);
  assert.equal(result.invalidCommittedMigrations.length, 2);
  assert.deepEqual(result.missingLocalMigrations, ['server/prisma/migrations/0003_link/migration.sql']);
});

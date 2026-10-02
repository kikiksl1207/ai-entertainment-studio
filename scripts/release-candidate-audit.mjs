import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCandidateReport } from './release-audit-evidence.mjs';
export { writeCandidateReport };

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const expectedRoot = 'E:\\Codex\\LuminaStage\\ai-entertainment-studio-git';
const allowedExtensions = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.prisma', '.sql', '.yml']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalizedHash = (bytes) => {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) return null;
  return hash(Buffer.from(source.replace(/\r\n/g, '\n'), 'utf8'));
};

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\x00-\x1f:?#]/.test(value) ||
      path.posix.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..') ||
      !allowedExtensions.has(path.posix.extname(value)) ||
      value.split('/').some((part) => part.startsWith('.') && part !== '.github') ||
      /(^|\/)(node_modules|dist|qa-artifacts|outputs|secrets?|credentials)(\/|$)/i.test(value) ||
      /^(secrets?|credentials?|id_rsa)(\.|$)/i.test(path.posix.basename(value))) {
    throw new Error(`Unsafe candidate path: ${String(value)}`);
  }
  return value;
}

function checkedFile(root, relative) {
  safePath(relative);
  const absolute = path.resolve(root, relative);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (!existsSync(current)) throw new Error(`Missing candidate file: ${relative}`);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Linked candidate path: ${relative}`);
  }
  if (realpathSync(absolute) !== absolute || !statSync(absolute).isFile()) {
    throw new Error(`Non-regular candidate file: ${relative}`);
  }
  if (statSync(absolute).size > 8 * 1024 * 1024) throw new Error(`Oversized candidate file: ${relative}`);
  return absolute;
}

export function validateManifest(manifest) {
  const keys = ['version', 'scope', 'serverEntries', 'groups', 'migrations'];
  if (!manifest || Object.keys(manifest).some((key) => !keys.includes(key)) || manifest.version !== 1 ||
      typeof manifest.scope !== 'string' || !manifest.scope.trim() || !Array.isArray(manifest.serverEntries) ||
      !manifest.serverEntries.length || !Array.isArray(manifest.groups) || !manifest.groups.length) {
    throw new Error('Invalid candidate manifest');
  }
  const ids = new Set();
  for (const entry of manifest.serverEntries) safePath(entry);
  if (new Set(manifest.serverEntries).size !== manifest.serverEntries.length) throw new Error('Duplicate server entry');
  for (const group of manifest.groups) {
    if (!group || Object.keys(group).some((key) => !['id', 'requires', 'files', 'serverFiles'].includes(key)) ||
        !/^[a-z][a-z0-9-]{1,63}$/.test(group.id) || ids.has(group.id) ||
        !Array.isArray(group.requires) || !Array.isArray(group.files) || !group.files.length ||
        !Array.isArray(group.serverFiles)) throw new Error('Invalid or duplicate candidate group');
    ids.add(group.id);
    for (const file of [...group.files, ...group.serverFiles]) safePath(file);
    for (const list of [group.files, group.serverFiles, group.requires]) {
      if (new Set(list).size !== list.length) throw new Error(`Duplicate group item: ${group.id}`);
    }
  }
  for (const group of manifest.groups) {
    if (group.requires.some((id) => !ids.has(id) || id === group.id)) throw new Error(`Unknown group dependency: ${group.id}`);
  }
  const active = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (active.has(id)) throw new Error(`Circular group dependency: ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const child of manifest.groups.find((group) => group.id === id).requires) visit(child);
    active.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  const migrations = manifest.migrations;
  if (!migrations || Object.keys(migrations).some((key) => !['directory', 'expectedCount', 'requiredInOrder'].includes(key)) ||
      !Number.isSafeInteger(migrations.expectedCount) || migrations.expectedCount < 1 ||
      migrations.directory !== 'server/prisma/migrations' || !Array.isArray(migrations.requiredInOrder) ||
      !migrations.requiredInOrder.length || new Set(migrations.requiredInOrder).size !== migrations.requiredInOrder.length ||
      migrations.requiredInOrder.some((name) => !/^[0-9][a-z0-9_]+$/.test(name))) {
    throw new Error('Invalid migration requirements');
  }
  return manifest;
}

function imports(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error(`Candidate syntax error: ${file}`);
  const references = [];
  const dynamic = [];
  const walk = (node) => {
    let value;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) value = node.moduleSpecifier;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) value = node.moduleReference.expression;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      value = node.arguments[0];
      if (!value || !ts.isStringLiteralLike(value)) dynamic.push(parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (value && ts.isStringLiteralLike(value)) references.push(value.text);
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return { references: [...new Set(references)], dynamic: [...new Set(dynamic)] };
}

export function gitReadOptions(root, inherited = process.env) {
  const env = {};
  for (const name of ['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR']) {
    if (inherited[name]) env[name] = inherited[name];
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    TEMP: 'E:\\Codex\\LuminaStage\\qa-temp', TMP: 'E:\\Codex\\LuminaStage\\qa-temp' });
  return { cwd: root, env, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
}

function gitRead(root, args, input, encoding = 'utf8') {
  return execFileSync('git', ['--no-optional-locks', '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', ...args], { ...gitReadOptions(root), encoding, input });
}

export function readGitSnapshot(root, ref = 'HEAD') {
  if (typeof ref !== 'string' || !/^[a-zA-Z0-9_/.-]+$/.test(ref) || ref.startsWith('-')) throw new Error('Invalid local Git reference');
  const git = (args) => gitRead(root, args);
  if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== realpathSync(root)) throw new Error('Wrong Git repository root');
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid resolved local commit');
  const paths = (args) => new Set(git(args).split('\0').filter(Boolean));
  const blobIds = new Map();
  const treeEntries = new Map();
  for (const item of git(['ls-tree', '--full-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(item);
    if (!match) throw new Error('Invalid local Git tree entry');
    treeEntries.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
    if (['100644', '100755'].includes(match[1]) && match[2] === 'blob') blobIds.set(match[4], match[3]);
  }
  return {
    commit, blobIds, treeEntries,
    tracked: paths(['ls-files', '--cached', '-z']),
    committed: new Set(blobIds.keys()),
  };
}

export function readCommittedHashes(root, snapshot, files) {
  const ids = [...new Set(files.map((file) => snapshot.blobIds.get(file)).filter(Boolean))];
  if (!ids.length) return new Map();
  const output = gitRead(root, ['cat-file', '--batch'], `${ids.join('\n')}\n`, null);
  const hashes = new Map();
  let offset = 0;
  for (const expectedId of ids) {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString('ascii');
    const match = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(header);
    if (end < 0 || !match || match[1] !== expectedId || Number(match[2]) > 8 * 1024 * 1024) throw new Error('Missing or invalid local Git blob');
    const start = end + 1;
    offset = start + Number(match[2]);
    if (output[offset] !== 10) throw new Error('Incomplete local Git blob');
    const bytes = output.subarray(start, offset++);
    const oid = createHash(expectedId.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (oid !== expectedId) throw new Error('Local Git blob integrity mismatch');
    hashes.set(expectedId, { rawSha256: hash(bytes), normalizedSha256: normalizedHash(bytes) });
  }
  if (offset !== output.length) throw new Error('Unexpected local Git blob output');
  return new Map(files.filter((file) => snapshot.blobIds.has(file)).map((file) => [file, hashes.get(snapshot.blobIds.get(file))]));
}

export function auditCandidate({ root, manifest, snapshot, readBytes = readFileSync, committedHashes = readCommittedHashes }) {
  validateManifest(manifest);
  root = path.resolve(root);
  if (realpathSync(root) !== root) throw new Error('Linked repository root');
  if (!snapshot || !/^[a-f0-9]{40,64}$/.test(snapshot.commit) ||
      !['tracked', 'committed'].every((key) => snapshot[key] instanceof Set) ||
      !(snapshot.treeEntries instanceof Map)) throw new Error('Invalid Git snapshot');
  const captured = new Map();
  const normalizedPaths = new Map();
  const read = (file) => {
    if (!captured.has(file)) {
      const normalized = file.normalize('NFC').toLowerCase();
      if (normalizedPaths.has(normalized) && normalizedPaths.get(normalized) !== file) throw new Error(`Colliding candidate path: ${file}`);
      normalizedPaths.set(normalized, file);
      const bytes = readBytes(checkedFile(root, file));
      if (!Buffer.isBuffer(bytes)) throw new Error('Expected source bytes');
      captured.set(file, { bytes, sha256: hash(bytes) });
    }
    return captured.get(file).bytes;
  };
  const queue = [...manifest.serverEntries];
  const server = new Set();
  const external = new Set();
  const dynamic = [];
  while (queue.length) {
    const file = queue.shift();
    if (server.has(file)) continue;
    server.add(file);
    if (server.size > 2000) throw new Error('Oversized server dependency graph');
    const source = read(file);
    if (!/\.(ts|js|mjs|cjs)$/.test(file)) continue;
    const discovered = imports(source.toString('utf8'), file);
    dynamic.push(...discovered.dynamic.map((line) => ({ file, line })));
    for (const specifier of discovered.references) {
      if (!specifier.startsWith('.')) {
        external.add(specifier);
        continue;
      }
      if (specifier.includes('\\') || /[\x00-\x1f:?#]/.test(specifier)) throw new Error(`Invalid import in ${file}`);
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const candidates = allowedExtensions.has(path.posix.extname(base)) ? [base] :
        [`${base}.ts`, `${base}.js`, `${base}.json`, `${base}/index.ts`, `${base}/index.js`];
      const resolved = candidates.find((candidate) => {
        safePath(candidate);
        return existsSync(path.join(root, candidate));
      });
      if (!resolved) throw new Error(`Unresolved relative import: ${file} -> ${specifier}`);
      queue.push(resolved);
    }
  }
  for (const group of manifest.groups) {
    for (const file of group.files) read(file);
    if (group.serverFiles.some((file) => !server.has(file))) throw new Error(`Unreachable server requirement: ${group.id}`);
  }
  const directory = path.resolve(root, manifest.migrations.directory);
  // A fake migration count must not hide a missing or linked SQL directory.
  let parent = root;
  for (const segment of manifest.migrations.directory.split('/')) {
    parent = path.join(parent, segment);
    if (!existsSync(parent) || lstatSync(parent).isSymbolicLink() || !statSync(parent).isDirectory()) {
      throw new Error('Invalid migration directory');
    }
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink())) throw new Error('Linked migration entry');
  const migrations = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (migrations.length !== manifest.migrations.expectedCount) throw new Error('Migration count changed; review the manifest');
  let previous = -1;
  for (const name of manifest.migrations.requiredInOrder) {
    const index = migrations.indexOf(name);
    if (index <= previous) throw new Error('Required migration missing or out of order');
    previous = index;
  }
  for (const name of migrations) read(`${manifest.migrations.directory}/${name}/migration.sql`);
  const committedMigrations = [...snapshot.treeEntries.keys()].filter((file) => /^server\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(file)).sort();
  const invalidCommittedMigrations = [...snapshot.treeEntries].filter(([file, entry]) =>
    file.startsWith('server/prisma/migrations/') && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)))
    .map(([file, entry]) => ({ file, mode: entry.mode, type: entry.type }));
  const localMigrations = migrations.map((name) => `${manifest.migrations.directory}/${name}/migration.sql`);
  const missingLocalMigrations = committedMigrations.filter((file) => !localMigrations.includes(file));
  const referenceHashes = committedHashes(root, snapshot, [...captured.keys()]);
  if (!(referenceHashes instanceof Map)) throw new Error('Missing committed source fingerprints');
  const files = [...captured].sort(([left], [right]) => left.localeCompare(right)).map(([file, record]) => {
    const current = readBytes(checkedFile(root, file));
    if (hash(current) !== record.sha256) throw new Error(`Candidate changed during audit: ${file}`);
    const reference = referenceHashes.get(file);
    const normalizedSha256 = normalizedHash(current);
    if (!normalizedSha256) throw new Error(`Non-UTF8 current candidate: ${file}`);
    if (snapshot.committed.has(file) && (!reference || !/^[a-f0-9]{64}$/.test(reference.rawSha256) ||
        !(reference.normalizedSha256 === null || /^[a-f0-9]{64}$/.test(reference.normalizedSha256)))) throw new Error(`Missing committed fingerprint: ${file}`);
    return { file, sha256: record.sha256, bytes: record.bytes.length, normalizedSha256,
      commitSha256: reference?.rawSha256 ?? null, normalizedSourceMatchesCommit: reference?.normalizedSha256 === normalizedSha256,
      committedEncoding: reference ? reference.normalizedSha256 === null ? 'non-utf8-needs-review' : 'utf8' : null,
      lineEndingOnlyDifference: !!reference && reference.rawSha256 !== record.sha256 && reference.normalizedSha256 === normalizedSha256,
      tracked: snapshot.tracked.has(file), inCommit: snapshot.committed.has(file),
      modifiedFromCommit: !!reference && reference.normalizedSha256 !== normalizedSha256 };
  });
  const blockers = files.filter((file) => !file.tracked || !file.inCommit || file.modifiedFromCommit || !file.normalizedSourceMatchesCommit);
  return {
    version: 1, scope: manifest.scope, commit: snapshot.commit, production: false, deployment: false, realAi: false,
    sourceInventoryVerified: true, inspectedFileCount: files.length, serverDependencyCount: server.size,
    migrationCount: migrations.length, manifestSha256: hash(Buffer.from(JSON.stringify(manifest))),
    groups: manifest.groups.map((group) => ({ id: group.id, requires: group.requires, files: group.files, serverFiles: group.serverFiles })),
    files, externalImports: [...external].sort(), dynamicImportsNeedingReview: dynamic,
    gitCandidateMatches: blockers.length === 0 && missingLocalMigrations.length === 0 && invalidCommittedMigrations.length === 0,
    blockers, missingLocalMigrations, invalidCommittedMigrations,
    limitations: ['Explicit static file list, not a complete HTML/CSS/media dependency parser',
      'Local import graph includes type-only imports; it is not proof of runtime DI or actual module boot',
      'External packages, variable imports, configuration, operational migration history and rollback need separate review',
      'This source inventory does not inspect or certify an actual deployment artifact',
      'Only CRLF/LF normalization is allowed in commit comparison; raw hashes are retained and no Git content filters are executed',
      'No deployment, paid provider invocation, original media or production data accessed'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'win32' || realpathSync(rootDirectory) !== expectedRoot) throw new Error('CLI requires the authorized E repository');
    const args = process.argv.slice(2);
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      if (!['--ref', '--output'].includes(args[index]) || !args[index + 1] || options.has(args[index])) throw new Error('Usage: node scripts/release-candidate-audit.mjs [--ref local-ref] [--output qa-artifacts/report.json]');
      options.set(args[index], args[index + 1]);
    }
    const manifest = JSON.parse(readFileSync(checkedFile(rootDirectory, 'scripts/release-candidate-20261002.json'), 'utf8'));
    const first = readGitSnapshot(rootDirectory, options.get('--ref') || 'HEAD');
    const result = auditCandidate({ root: rootDirectory, manifest, snapshot: first });
    const last = readGitSnapshot(rootDirectory, first.commit);
    const changed = (key) => result.files.some(({ file }) => first[key].has(file) !== last[key].has(file));
    if (['tracked', 'committed'].some(changed) || result.files.some(({ file }) => first.blobIds.get(file) !== last.blobIds.get(file))) throw new Error('Git candidate changed during audit');
    if (options.has('--output')) {
      writeCandidateReport(rootDirectory, options.get('--output'), result);
      process.stdout.write(`${JSON.stringify({ evidence: options.get('--output'), inspectedFileCount: result.inspectedFileCount,
        serverDependencyCount: result.serverDependencyCount, migrationCount: result.migrationCount,
        blockers: result.blockers.length, dynamicImports: result.dynamicImportsNeedingReview.length, gitCandidateMatches: result.gitCandidateMatches })}\n`);
    } else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.gitCandidateMatches && !result.dynamicImportsNeedingReview.length ? 0 : 2;
  } catch (error) {
    process.stderr.write(`Candidate audit stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}

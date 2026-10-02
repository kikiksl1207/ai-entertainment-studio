import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCandidateReport } from './release-audit-evidence.mjs';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const expectedRoot = 'E:\\Codex\\LuminaStage\\ai-entertainment-studio-git';
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const version = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/;
const constraint = /^(?:[~^])?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/;
const tools = ['typescript', 'prisma', '@nestjs/cli'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function comparePackageMetadata({ manifest, lock, installed }) {
  if (!manifest?.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies) ||
      !Object.keys(manifest.dependencies).length || lock?.lockfileVersion !== 3 || !lock.packages?.[''] ||
      !(installed instanceof Map)) throw new Error('Invalid package comparison inputs');
  const records = [];
  for (const [kind, dependencies] of [['runtime', manifest.dependencies],
    ['build-tool', Object.fromEntries(tools.map((name) => [name, manifest.devDependencies?.[name]]))]]) {
    if (Object.keys(dependencies).length > 200) throw new Error('Oversized direct package list');
    for (const [name, requested] of Object.entries(dependencies)) {
      if (!packageName.test(name) || typeof requested !== 'string' || !constraint.test(requested) || requested.length > 200) {
        throw new Error('Invalid direct package name or constraint');
      }
      const expected = lock.packages[`node_modules/${name}`];
      const actual = installed.get(name);
      const lockedRequest = lock.packages[''][kind === 'runtime' ? 'dependencies' : 'devDependencies']?.[name];
      let state = 'matches';
      if (lockedRequest !== requested) state = 'manifest-lock-mismatch';
      else if (!expected || expected.link || !version.test(expected.version ?? '')) state = 'invalid-lock-entry';
      else if (!actual) state = 'missing';
      else if (actual.name !== name || !version.test(actual.version ?? '')) state = 'invalid-installed-metadata';
      else if (actual.version !== expected.version) state = 'installed-version-mismatch';
      records.push({ name, kind, requested, lockedVersion: version.test(expected?.version ?? '') ? expected.version : null,
        installedVersion: version.test(actual?.version ?? '') ? actual.version : null, state });
    }
  }
  const lockedRuntimeNames = Object.keys(lock.packages[''].dependencies ?? {});
  if (lockedRuntimeNames.some((name) => !packageName.test(name))) throw new Error('Invalid locked runtime package name');
  const extraLockedRuntime = lockedRuntimeNames.filter((name) =>
    !Object.hasOwn(manifest.dependencies, name)).sort();
  return { records: records.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), extraLockedRuntime,
    versionConstraintsVerified: false,
    directMetadataMatches: records.every((record) => record.state === 'matches') && !extraLockedRuntime.length };
}

function checkedFile(root, relative, missing = false) {
  let absolute = root;
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.' || segment === '..' || /[\\:\x00-\x1f]/.test(segment)) throw new Error('Unsafe package path');
    absolute = path.join(absolute, segment);
    if (!existsSync(absolute)) {
      if (missing) return null;
      throw new Error('Missing package input');
    }
    if (lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error('Linked package input');
  }
  if (!statSync(absolute).isFile() || statSync(absolute).size > 16 * 1024 * 1024) throw new Error('Invalid package input');
  return absolute;
}

export function auditLocalPackages(root) {
  root = path.resolve(root);
  if (realpathSync(root) !== root) throw new Error('Linked package root');
  const captured = new Map();
  const read = (relative, missing = false) => {
    const file = checkedFile(root, relative, missing);
    if (!file) return null;
    const bytes = readFileSync(file);
    captured.set(relative, hash(bytes));
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Invalid package JSON');
    }
  };
  const manifest = read('server/package.json');
  const lock = read('server/package-lock.json');
  const names = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...tools])];
  if (names.length > 203 || names.some((name) => !packageName.test(name))) throw new Error('Invalid package inventory');
  const installed = new Map(names.map((name) => [name, read(`server/node_modules/${name}/package.json`, true)]));
  const comparison = comparePackageMetadata({ manifest, lock, installed });
  for (const [file, fingerprint] of captured) {
    if (hash(readFileSync(checkedFile(root, file))) !== fingerprint) throw new Error('Package metadata changed during audit');
  }
  return { version: 1, scope: 'Local direct runtime package and selected build-tool metadata compared with lockfile v3',
    production: false, deployment: false, realAi: false, ...comparison,
    inputs: [...captured].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })),
    limitations: ['Reads package JSON only; never loads package code, installs or invokes a provider',
      'Does not verify transitive dependencies, file integrity against npm tarballs or lock integrity fields',
      'Supports only exact, caret or tilde numeric version constraints, not private registry URLs or npm aliases',
      'Does not verify that locked versions satisfy the requested semver constraints',
      'Does not certify native binaries, generated Prisma engine/client, production OS or clean npm ci',
      'Version equality is metadata evidence, not a runtime, security or reproducible-artifact certificate',
      'End rechecks are not an atomic filesystem snapshot or complete path-swap protection',
      'No production configuration, migration history, deployment or rollback approval inferred'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'win32' || realpathSync(rootDirectory) !== expectedRoot) throw new Error('CLI requires the authorized E repository');
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node scripts/release-package-audit.mjs --output qa-artifacts/report.json');
    const report = auditLocalPackages(rootDirectory);
    writeCandidateReport(rootDirectory, args[1], report);
    process.stdout.write(`${JSON.stringify({ evidence: args[1], directRuntime: report.records.filter((r) => r.kind === 'runtime').length,
      buildTools: report.records.filter((r) => r.kind === 'build-tool').length,
      mismatches: report.records.filter((r) => r.state !== 'matches').length, directMetadataMatches: report.directMetadataMatches })}\n`);
    process.exitCode = report.directMetadataMatches ? 0 : 2;
  } catch (error) {
    process.stderr.write(`Package audit stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}
